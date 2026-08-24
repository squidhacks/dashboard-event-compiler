<#
  Control script for the personal dashboard background service.

    powershell -ExecutionPolicy Bypass -File scripts\dashboard.ps1 <command>

    install    register the logon task, then start the dashboard now
    uninstall  remove the logon task and stop the dashboard
    start      start it now (without touching the logon task)
    stop       stop it now
    restart    stop, then start
    status     whether it is running, since when, and if it is answering
    log        show the tail of server.log
#>
param(
  [ValidateSet("install", "uninstall", "start", "stop", "restart", "status", "log")]
  [string]$Command = "status",
  [int]$Lines = 40
)

$ErrorActionPreference = "Stop"

$Root     = Split-Path -Parent $PSScriptRoot
$Vbs      = Join-Path $PSScriptRoot "launch-hidden.vbs"
$LogPath  = Join-Path $Root "server.log"
$TaskName = "PersonalDashboard"
$Account  = "$env:USERDOMAIN\$env:USERNAME"

# Keep the port in step with config.json rather than hardcoding it twice.
$Port = 3000
try {
  $cfg = Get-Content (Join-Path $Root "config.json") -Raw | ConvertFrom-Json
  if ($cfg.port) { $Port = [int]$cfg.port }
} catch { }
$Url = "http://localhost:$Port"

function Resolve-Node {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { return $p } }
  throw "Could not find node.exe. Install Node.js or add it to PATH."
}

# The process holding the port is the authoritative "is it up" answer.
function Get-ServerPid {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
  } catch { }
  return $null
}

function Get-LauncherProcs {
  Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*launch-hidden.vbs*" }
}

function Test-Responding {
  try {
    Invoke-WebRequest -Uri "$Url/api/config" -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch { return $false }
}

function Start-Dashboard {
  if (Get-ServerPid) { Write-Host "Already running at $Url"; return }
  $node = Resolve-Node
  Start-Process -FilePath "wscript.exe" `
                -ArgumentList @("`"$Vbs`"", "`"$node`"") `
                -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 500
    if (Test-Responding) { Write-Host "Dashboard is up at $Url"; return }
  }
  Write-Warning "Started, but it did not answer within 10s. Check: dashboard.ps1 log"
}

function Stop-Dashboard {
  # Stop the launcher first so it does not restart node out from under us.
  foreach ($p in Get-LauncherProcs) {
    taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
  }
  $serverPid = Get-ServerPid
  if ($serverPid) { taskkill /PID $serverPid /T /F 2>$null | Out-Null }
  Start-Sleep -Milliseconds 500
  if (Get-ServerPid) { Write-Warning "Something is still listening on port $Port." }
  else { Write-Host "Dashboard stopped." }
}

function Install-Task {
  $node = Resolve-Node
  $action = New-ScheduledTaskAction -Execute "wscript.exe" `
                                    -Argument "`"$Vbs`" `"$node`"" `
                                    -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $Account
  # ExecutionTimeLimit 0 = never time out; IgnoreNew = never run two copies.
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                                           -DontStopIfGoingOnBatteries `
                                           -StartWhenAvailable `
                                           -MultipleInstances IgnoreNew `
                                           -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  $principal = New-ScheduledTaskPrincipal -UserId $Account -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
                         -Settings $settings -Principal $principal `
                         -Description "Starts the personal dashboard at logon (http://localhost:$Port)." `
                         -Force | Out-Null
  Write-Host "Registered logon task '$TaskName' for $Account."
  Start-Dashboard
}

function Uninstall-Task {
  Stop-Dashboard
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed logon task '$TaskName'."
  } catch {
    Write-Host "No logon task named '$TaskName' was registered."
  }
}

function Show-Status {
  $serverPid = Get-ServerPid
  if ($serverPid) {
    $proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
    Write-Host "Running    yes (pid $serverPid)"
    if ($proc) {
      $up = (Get-Date) - $proc.StartTime
      Write-Host ("Uptime     {0}d {1}h {2}m" -f $up.Days, $up.Hours, $up.Minutes)
    }
  } else {
    Write-Host "Running    no"
  }
  Write-Host "URL        $Url"
  Write-Host ("Responding {0}" -f $(if (Test-Responding) { "yes" } else { "no" }))

  try {
    $auth = Invoke-RestMethod -Uri "$Url/api/auth/status" -TimeoutSec 5
    Write-Host ("Google     {0}" -f $(if ($auth.connected) { "connected" } else { "not connected" }))
  } catch { }

  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Write-Host "Logon task registered ($($task.State)) - starts automatically when you sign in."
  } else {
    Write-Host "Logon task not registered - run: dashboard.ps1 install"
  }
}

switch ($Command) {
  "install"   { Install-Task }
  "uninstall" { Uninstall-Task }
  "start"     { Start-Dashboard }
  "stop"      { Stop-Dashboard }
  "restart"   { Stop-Dashboard; Start-Dashboard }
  "status"    { Show-Status }
  "log"       {
    if (Test-Path $LogPath) { Get-Content $LogPath -Tail $Lines }
    else { Write-Host "No log yet at $LogPath" }
  }
}
