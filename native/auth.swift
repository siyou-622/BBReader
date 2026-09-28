import Foundation
import Security
import LocalAuthentication

private let credentialQuery:[String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"cn.sustech.bbreader.cas",kSecAttrAccount as String:"campus-login"]
func handleAuth(_ msg:[String:Any]) throws -> [String:Any] {
    let op=try string(msg,"op")
    if op=="saveCredentials" {
        let username=try string(msg,"username"),password=try string(msg,"password")
        guard username.count<=128,password.count<=1024,!username.contains("\n") else {throw Failure("账号或密码格式不正确")}
        let data=try JSONSerialization.data(withJSONObject:["username":username,"password":password])
        var status=SecItemUpdate(credentialQuery as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status==errSecItemNotFound {
            var add=credentialQuery;add[kSecValueData as String]=data;add[kSecAttrLabel as String]="BBReader · 南科大 CAS"
            // The login keychain protects this app-owned item; do not require userPresence/Touch ID.
            status=SecItemAdd(add as CFDictionary,nil)
        }
        guard status==errSecSuccess else {throw Failure("未能保存专属登录凭据（系统错误 \(status)）")}
        return ["ok":true]
    }
    if op=="deleteCredentials" {
        let status=SecItemDelete(credentialQuery as CFDictionary)
        guard status==errSecSuccess || status==errSecItemNotFound else {throw Failure("未能删除登录凭据（系统错误 \(status)）")}
        return ["ok":true]
    }
    guard op=="credentialStatus" || op=="readCredentials" else {throw Failure("未知认证操作")}
    var query=credentialQuery
    // Scheduled checks must never block waiting for a keychain authorization dialog.
    let context=LAContext();context.interactionNotAllowed=true
    query[kSecUseAuthenticationContext as String]=context
    query[kSecReturnData as String]=op=="readCredentials"
    query[kSecReturnAttributes as String]=op=="credentialStatus"
    query[kSecMatchLimit as String]=kSecMatchLimitOne
    var value:CFTypeRef?
    let status=SecItemCopyMatching(query as CFDictionary,&value)
    if status==errSecItemNotFound {return ["ok":true,"configured":false]}
    guard status==errSecSuccess else {throw Failure("钥匙串暂不可后台访问，请解锁或在设置中重新保存凭据；本次不会弹出认证（系统错误 \(status)）")}
    if op=="credentialStatus" {return ["ok":true,"configured":true]}
    guard let data=value as? Data,let credentials=try JSONSerialization.jsonObject(with:data) as? [String:String],let username=credentials["username"],let password=credentials["password"] else {throw Failure("已保存凭据格式无效，请重新保存")}
    return ["ok":true,"configured":true,"username":username,"password":password]
}
