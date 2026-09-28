import Foundation
import EventKit

struct ReminderRecord: Codable {
    var identifier: String
    var submitted: Bool
}
struct ReminderAccount: Codable {
    var calendarID: String
    var records: [String:ReminderRecord] = [:]
}
func reminderStateURL() -> URL { home.appendingPathComponent("reminders.json") }
func reminderState() throws -> [String:ReminderAccount] {
    guard fm.fileExists(atPath:reminderStateURL().path) else {return [:]}
    return try JSONDecoder().decode([String:ReminderAccount].self,from:Data(contentsOf:reminderStateURL()))
}
func saveReminderState(_ state:[String:ReminderAccount]) throws {
    try fm.createDirectory(at:home,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    try JSONEncoder().encode(state).write(to:reminderStateURL(),options:.atomic)
    try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:reminderStateURL().path)
}
func awaitEventKit<T>(_ timeout:TimeInterval = 30, _ begin:(@escaping (T)->Void)->Void) throws -> T {
    let lock=NSLock();var result:T?
    begin {value in lock.lock();result=value;lock.unlock()}
    let end=Date().addingTimeInterval(timeout)
    while Date()<end {
        lock.lock();let value=result;lock.unlock()
        if let value=value {return value}
        _ = RunLoop.current.run(mode:.default,before:Date().addingTimeInterval(0.05))
    }
    throw Failure("提醒事项服务响应超时；请处理系统授权提示后重试")
}
func reminderAccess() -> Bool {
    if #available(macOS 14.0, *) {return EKEventStore.authorizationStatus(for:.reminder) == .fullAccess}
    return EKEventStore.authorizationStatus(for:.reminder) == .authorized
}
func requestReminders(_ store:EKEventStore) throws {
    if reminderAccess(){return}
    let result:(Bool,Error?) = try awaitEventKit(180) { finish in
        if #available(macOS 14.0, *) {store.requestFullAccessToReminders {finish(($0,$1))}}
        else {store.requestAccess(to:.reminder) {finish(($0,$1))}}
    }
    guard result.0 else {throw Failure(result.1?.localizedDescription ?? "提醒事项权限未允许，请到系统设置 → 隐私与安全性 → 提醒事项中允许 BBReader Helper")}
}
// A manual completion (or reopening after a previous submission) belongs to the user.
func reminderCompletion(existing:Bool?,previousSubmitted:Bool?,submitted:Bool) -> Bool {
    guard let existing=existing else {return submitted}
    return existing || (submitted && previousSubmitted == false)
}
let reminderListTitle="BBReader · 作业"
// BBReader writes no notes. Strip anything older versions generated (ID markers of any account, boilerplate,
// stray HTML entities) so Reminders shows only the title, due time, link and whatever the user wrote.
func cleanReminderNotes(_ notes:String?,marker:String) -> String? {
    guard var text=notes else {return nil}
    let explanation="完成勾选仅记录在 Reminders，不会提交 Blackboard 作业。"
    for fragment in [explanation+"&#x20;",explanation,"来自 Blackboard。",marker,"&#x20;"] {
        text=text.replacingOccurrences(of:fragment,with:"")
    }
    text=text.replacingOccurrences(of:"BBReader-ID: [a-f0-9]{24}/_[0-9]+_[0-9]+:_[0-9]+_[0-9]+",with:"",options:.regularExpression)
    text=text.replacingOccurrences(of:"\n{3,}",with:"\n\n",options:.regularExpression)
    text=text.trimmingCharacters(in:.whitespacesAndNewlines)
    return text.isEmpty ? nil : text
}
struct ReminderTask {
    let key:String, title:String, course:String, url:URL, due:Date?, submitted:Bool
    init(_ raw:[String:Any]) throws {
        let courseID=try string(raw,"courseId"),id=try string(raw,"id")
        guard validCourse(courseID),validCourse(id) else {throw Failure("无效作业标识")}
        course=try string(raw,"courseName");title=try string(raw,"title");key=courseID+":"+id
        guard title.count<=1000,course.count<=500,let link=URL(string:try string(raw,"url")),link.scheme=="https",link.host=="bb.sustech.edu.cn",link.path=="/webapps/assignment/uploadAssignment",link.user==nil,link.password==nil else {throw Failure("无效作业链接或标题")}
        let query=URLComponents(url:link,resolvingAgainstBaseURL:false)?.queryItems ?? []
        guard query.first(where:{$0.name=="course_id"})?.value==courseID,query.first(where:{$0.name=="content_id"})?.value==id else {throw Failure("作业链接与标识不匹配")}
        url=link;submitted=["submitted","graded"].contains(raw["status"] as? String ?? "")
        if let iso=raw["due"] as? String,!iso.isEmpty {
            let parser=ISO8601DateFormatter();parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
            var parsed=parser.date(from:iso)
            if parsed==nil {parser.formatOptions=[.withInternetDateTime];parsed=parser.date(from:iso)}
            guard let date=parsed else {throw Failure("作业截止时间格式无效")};due=date
        } else {due=nil}
    }
    var displayTitle:String {"\(course) · \(title)"}
}
func handleReminders(_ msg:[String:Any]) throws -> [String:Any] {
    let account=try string(msg,"account")
    guard account.range(of:"^[a-f0-9]{24}$",options:.regularExpression) != nil else {throw Failure("无效账户标识")}
    let op=try string(msg,"op"),connect=op=="connectReminders"
    guard connect || op=="syncReminders" else {throw Failure("未知提醒事项操作")}
    guard let raw=msg["assignments"] as? [[String:Any]],raw.count<=2000 else {throw Failure("无效作业列表")}
    let tasks=try raw.map(ReminderTask.init)
    guard Set(tasks.map(\.key)).count==tasks.count else {throw Failure("作业标识重复")}
    let store=EKEventStore()
    if connect {try requestReminders(store)}
    guard reminderAccess() else {throw Failure("请先连接 Apple Reminders 并允许提醒事项访问")}
    var all=try reminderState(),saved=all[account]
    var list=saved.flatMap {store.calendar(withIdentifier:$0.calendarID)}
    if list==nil {
        guard connect else {throw Failure("BBReader 提醒事项列表已移除，请重新连接")}
        guard let source=store.defaultCalendarForNewReminders()?.source ?? store.sources.first(where:{$0.sourceType == .local}) else {throw Failure("没有可写入的提醒事项账户，请先打开 Reminders 设置账户")}
        let created=EKCalendar(for:.reminder,eventStore:store)
        created.title=reminderListTitle // No account hash in the visible list name.
        created.source=source;try store.saveCalendar(created,commit:true)
        list=created;saved=ReminderAccount(calendarID:created.calendarIdentifier)
        all[account]=saved;try saveReminderState(all)
    }
    guard let list=list,list.allowsContentModifications,var saved=saved else {throw Failure("BBReader 提醒事项列表不可写入")}
    // Older versions appended an account hash for a second account; restore the plain name.
    if list.title.range(of:"^BBReader · 作业 [a-f0-9]{6}$",options:.regularExpression) != nil {list.title=reminderListTitle;try store.saveCalendar(list,commit:true)}
    let loaded:[EKReminder]? = try awaitEventKit {done in
        store.fetchReminders(matching:store.predicateForReminders(in:[list])) {done($0)}
    }
    guard let existing=loaded else {throw Failure("无法读取已有提醒事项，已停止以避免重复创建")}
    let byID=Dictionary(existing.map{($0.calendarItemIdentifier,$0)},uniquingKeysWith:{first,_ in first})
    var cleanedNotes=0
    for (key,record) in saved.records {
        guard let item=byID[record.identifier] else {continue}
        let clean=cleanReminderNotes(item.notes,marker:"BBReader-ID: \(account)/\(key)")
        if clean != item.notes {item.notes=clean;try store.save(item,commit:true);cleanedNotes+=1}
    }
    var created=0,updated=0,removed=0,completed:[String:Bool]=[:]
    // Courses the user unticked in BBReader: remove only the reminders BBReader created for them.
    let removeCourses=Set((msg["removeCourses"] as? [String] ?? []).filter(validCourse))
    for (key,record) in Array(saved.records) where removeCourses.contains(String(key.split(separator:":").first ?? "")) {
        if let item=byID[record.identifier] {try store.remove(item,commit:false);removed+=1}
        saved.records[key]=nil
    }
    let claimed=Set(saved.records.values.map(\.identifier))
    for task in tasks {
        let marker="BBReader-ID: \(account)/\(task.key)"
        let old=saved.records[task.key]
        let matches=existing.filter{$0.url?.absoluteString==task.url.absoluteString || ($0.notes ?? "").contains(marker)}
        let item=old.flatMap{byID[$0.identifier]} ?? matches.first
        // Duplicates of the same assignment in the BBReader list are noise; keep one.
        for extra in matches where extra.calendarItemIdentifier != item?.calendarItemIdentifier && !claimed.contains(extra.calendarItemIdentifier) {
            try store.remove(extra,commit:false);removed+=1
        }
        let reminder=item ?? EKReminder(eventStore:store)
        if item==nil {
            reminder.calendar=list
            created+=1
        } else {
            updated+=1
        }
        // Remove only BBReader's old boilerplate; retain user-authored notes.
        reminder.notes=cleanReminderNotes(reminder.notes,marker:marker)
        reminder.title=task.displayTitle;reminder.url=task.url
        if let due=task.due {
            var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone(identifier:"Asia/Shanghai")!
            var components=calendar.dateComponents([.year,.month,.day,.hour,.minute,.second],from:due)
            components.calendar=calendar;components.timeZone=calendar.timeZone
            reminder.startDateComponents=components;reminder.dueDateComponents=components
        }
        let complete=reminderCompletion(existing:item?.isCompleted,previousSubmitted:old?.submitted,submitted:task.submitted)
        if reminder.isCompleted != complete {reminder.isCompleted=complete}
        try store.save(reminder,commit:true)
        saved.records[task.key]=ReminderRecord(identifier:reminder.calendarItemIdentifier,submitted:task.submitted)
        completed[task.key]=reminder.isCompleted
        all[account]=saved;try saveReminderState(all)
    }
    try store.commit();all[account]=saved;try saveReminderState(all)
    return ["ok":true,"created":created,"updated":updated,"removed":removed,"completed":completed,"list":list.title,"cleanedNotes":cleanedNotes]
}
func remindersSelfTest() throws {
    let boilerplate="来自 Blackboard。完成勾选仅记录在 Reminders，不会提交 Blackboard 作业。"
    require(cleanReminderNotes(boilerplate+"&#x20;",marker:"BBReader-ID: test")==nil)
    require(cleanReminderNotes("BBReader-ID: test\n"+boilerplate+"\n自己写的备注",marker:"BBReader-ID: test")=="自己写的备注")
    require(cleanReminderNotes("自己写的备注",marker:"BBReader-ID: test")=="自己写的备注")
    require(cleanReminderNotes("BBReader-ID: \(String(repeating:"b",count:24))/_1_1:_2_1\n&#x20;",marker:"BBReader-ID: other")==nil)
    require(cleanReminderNotes("第一行\n\n\n\n第二行",marker:"x")=="第一行\n\n第二行")
    require(reminderCompletion(existing:nil,previousSubmitted:nil,submitted:false)==false)
    require(reminderCompletion(existing:nil,previousSubmitted:nil,submitted:true)==true)
    require(reminderCompletion(existing:true,previousSubmitted:false,submitted:false)==true)
    require(reminderCompletion(existing:false,previousSubmitted:false,submitted:true)==true)
    require(reminderCompletion(existing:false,previousSubmitted:true,submitted:true)==false)
    let task=try ReminderTask(["id":"_2_1","courseId":"_1_1","courseName":"Compilers","title":"Assignment1","url":"https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id=_1_1&content_id=_2_1","due":"2026-09-27T15:59:00.000Z"])
    require(task.displayTitle=="Compilers · Assignment1")
    require(task.due==ISO8601DateFormatter().date(from:"2026-09-27T15:59:00Z"))
    print("Reminder tests passed: clean notes, course title, exact due date, completion preservation, submission transition.")
}
