param([ValidateSet('protect','unprotect')][string]$Action)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName System.Security
$value=[Console]::In.ReadToEnd()
$entropy=[Text.Encoding]::UTF8.GetBytes('GreenLoong MCSManager login v1')
if($Action -eq 'protect'){
 $data=[Text.Encoding]::UTF8.GetBytes($value)
 [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)))
}else{
 $data=[Convert]::FromBase64String($value.Trim())
 [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)))
}
