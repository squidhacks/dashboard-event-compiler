<#
    setup_igchecker_task.ps1 — registers the "IGChecker - Western Events" scheduled task.

    Runs run_igchecker.ps1 (its sibling in this folder) every 2 days at 08:47, only while
    (needed so Claude-in-Chrome can reach the signed-in Instagram session).

    Re-run this script any time to update the task definition; it overwrites in place.

    Useful commands:
      Get-ScheduledTask     -TaskName 'IGChecker - Western Events'
      Get-ScheduledTaskInfo -TaskName 'IGChecker - Western Events'   # last/next run + result
      Start-ScheduledTask   -TaskName 'IGChecker - Western Events'   # run now
      Disable-ScheduledTask -TaskName 'IGChecker - Western Events'
      Unregister-ScheduledTask -TaskName 'IGChecker - Western Events' -Confirm:$false
#>

$ErrorActionPreference = 'Stop'

$TaskName   = 'IGChecker - Western Events'
$ScriptPath = Join-Path $PSScriptRoot 'run_igchecker.ps1'
$WorkingDir = $PSScriptRoot
$RunAt      = '08:47'

if (-not (Test-Path $ScriptPath)) { throw "Missing runner script: $ScriptPath" }

$action = New-ScheduledTaskAction `
    -Execute  'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $WorkingDir

# DaysInterval 2 = every other day, counted from the first trigger date.
$trigger = New-ScheduledTaskTrigger -Daily -DaysInterval 2 -At $RunAt

# InteractiveToken: runs in the logged-on desktop session so Chrome is reachable.
$principal = New-ScheduledTaskPrincipal `
    -UserId    "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel  Limited

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
    -TaskName    $TaskName `
    -Description 'Every other day: sweeps Western/UWO club Instagram accounts and official web sources, updates western_club_findings.json, and reports what changed.' `
    -Action      $action `
    -Trigger     $trigger `
    -Principal   $principal `
    -Settings    $settings `
    -Force | Out-Null

Write-Output "Registered '$TaskName'."
Get-ScheduledTask -TaskName $TaskName |
    Select-Object TaskName, State, @{n='NextRun';e={ (Get-ScheduledTaskInfo $_.TaskName).NextRunTime }} |
    Format-List
