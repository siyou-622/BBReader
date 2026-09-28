import AppKit

struct PickerError: Error { let message:String }
let fm=FileManager.default
let executable=URL(fileURLWithPath:CommandLine.arguments[0]).standardizedFileURL
func readBytes(_ count:Int) throws -> Data {
    var data=Data()
    while data.count<count {
        guard let chunk=try FileHandle.standardInput.read(upToCount:count-data.count),!chunk.isEmpty else {throw PickerError(message:"文件夹选择请求不完整")}
        data.append(chunk)
    }
    return data
}
func reply(_ value:[String:Any]) throws {
    let data=try JSONSerialization.data(withJSONObject:value);var size=UInt32(data.count).littleEndian
    FileHandle.standardOutput.write(Data(bytes:&size,count:4));FileHandle.standardOutput.write(data)
}
func run() throws {
    let origin=try String(contentsOf:executable.deletingLastPathComponent().appendingPathComponent("extension-origin.txt"),encoding:.utf8).trimmingCharacters(in:.whitespacesAndNewlines)
    guard origin.range(of:"^chrome-extension://[a-p]{32}/$",options:.regularExpression) != nil else {throw PickerError(message:"扩展来源无效")}
    if CommandLine.arguments.contains("--install") {
        let bundle=fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/BBReader/BBReader Folder Picker.app/Contents")
        let macOS=bundle.appendingPathComponent("MacOS")
        try fm.createDirectory(at:macOS,withIntermediateDirectories:true)
        let binary=macOS.appendingPathComponent("bbreader-picker")
        try Data(contentsOf:executable).write(to:binary,options:.atomic)
        try fm.setAttributes([.posixPermissions:0o700],ofItemAtPath:binary.path)
        try Data(origin.utf8).write(to:macOS.appendingPathComponent("extension-origin.txt"))
        let info:[String:Any]=["CFBundleIdentifier":"cn.sustech.bbreader.picker","CFBundleName":"BBReader Folder Picker","CFBundleExecutable":"bbreader-picker","CFBundlePackageType":"APPL","CFBundleVersion":"1","LSUIElement":true,"NSHighResolutionCapable":true]
        try PropertyListSerialization.data(fromPropertyList:info,format:.xml,options:0).write(to:bundle.appendingPathComponent("Info.plist"))
        let hosts=fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts")
        try fm.createDirectory(at:hosts,withIntermediateDirectories:true)
        let manifest:[String:Any]=["name":"cn.sustech.bbreader.picker","description":"BBReader folder chooser","path":binary.path,"type":"stdio","allowed_origins":[origin]]
        try JSONSerialization.data(withJSONObject:manifest,options:.prettyPrinted).write(to:hosts.appendingPathComponent("cn.sustech.bbreader.picker.json"))
        print("macOS 文件夹选择器已安装。")
        return
    }
    guard CommandLine.arguments.dropFirst().contains(origin) else {throw PickerError(message:"不允许的扩展来源")}
    let header=try readBytes(4),size=header.withUnsafeBytes{Int(UInt32(littleEndian:$0.loadUnaligned(as:UInt32.self)))}
    guard size>0,size<=16384 else {throw PickerError(message:"无效选择请求")}
    guard let request=try JSONSerialization.jsonObject(with:readBytes(size)) as? [String:Any],request["op"] as? String=="chooseFolder" else {throw PickerError(message:"未知选择操作")}
    let app=NSApplication.shared;app.setActivationPolicy(.accessory);app.finishLaunching()
    let panel=NSOpenPanel()
    panel.title="BBReader · 选择保存文件夹";panel.prompt="选择文件夹"
    panel.message=String((request["title"] as? String ?? "选择课件保存根目录").prefix(500))+"（个人目录中的文件夹）"
    panel.canChooseFiles=false;panel.canChooseDirectories=true;panel.allowsMultipleSelection=false;panel.canCreateDirectories=true
    panel.directoryURL=fm.homeDirectoryForCurrentUser
    if let path=request["directory"] as? String,path.hasPrefix("/") {
        let url=URL(fileURLWithPath:path,isDirectory:true).standardizedFileURL.resolvingSymlinksInPath()
        if url.path.hasPrefix(fm.homeDirectoryForCurrentUser.path+"/"),fm.fileExists(atPath:url.path) {panel.directoryURL=url}
    }
    app.activate(ignoringOtherApps:true)
    if panel.runModal() == .OK,let url=panel.url {try reply(["ok":true,"path":url.path])}
    else {try reply(["ok":true,"cancelled":true])}
}
do {try run()} catch {
    try? reply(["ok":false,"error":(error as? PickerError)?.message ?? "无法打开文件夹选择窗口，请重试或重新安装本地助手"])
    exit(1)
}
