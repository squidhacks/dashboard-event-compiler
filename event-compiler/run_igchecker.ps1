<#
    run_igchecker.ps1 -- daily run of the western-club-events skill.

    Registered with Windows Task Scheduler as "IGChecker - Western Events".
    Runs only while the user is logged on, so the Claude-in-Chrome integration can
    reach the already-signed-in Instagram session (Lane A of the skill).

    Three phases:
      1. Sweep  -- Claude reads Instagram (Lane A) + the web registry (Lane B),
                  writes western_club_findings.json. No shell, no calendar tools.
      2. Plan   -- THIS script runs `node calendar/build-plan-main.js`. Running it
                  here rather than granting the agent a shell is what keeps the
                  Bash/PowerShell denial in phase 1 meaningful.
      3. Sync   -- Claude writes calendar-plan.json to the Western Clubs calendar.
                  Calendar tools only; still no shell.

    Tier rotation: Tier 1 handles sweep every run; Tiers 2-4 every third run.
    Lane A screenshots dominate the cost of a run, and lower tiers move slowly.

    Re-register / inspect:  see setup_igchecker_task.ps1
    Logs:                   .\logs\igchecker-<timestamp>.log
    Run status (dashboard): .\run-status.json
#>

$ErrorActionPreference = 'Stop'

# Everything is relative to this script, so the checkout can live anywhere.
$ProjectDir  = $PSScriptRoot
$LogDir      = Join-Path $ProjectDir 'logs'
$BackupDir   = Join-Path $ProjectDir 'backups'
$Findings    = Join-Path $ProjectDir 'western_club_findings.json'
$PlanFile    = Join-Path $ProjectDir 'calendar\calendar-plan.json'
$PlanScript  = Join-Path $ProjectDir 'calendar\build-plan-main.js'
$StatusFile  = Join-Path $ProjectDir 'run-status.json'
$StateFile   = Join-Path $ProjectDir '.run-state.json'
$KeepLogs    = 20
$KeepBackups = 20

# Both headless phases run Sonnet rather than inheriting the interactive default
# of Opus from settings.json. Measured on run #1: Opus cost $8.83 for a single
# tier-1 sweep, and cache *writes* were its largest line ($4.45 of it). This is
# sweep-and-transcribe work, not deep reasoning, so Sonnet does it for roughly
# 2.4x less against the same 5-hour subscription quota that the interactive
# sessions draw from. Set to 'opus' here to revert both phases at once.
$Model       = 'sonnet'

$CalendarId  = 'c_f7fa345c7e66ffa9834e079610bca9c287a9acd919457f66157aa3d08be86dcd@group.calendar.google.com'

# Prefer claude.exe on PATH; fall back to the default per-user install location.
$ClaudeExe = (Get-Command claude.exe -ErrorAction SilentlyContinue).Source
if (-not $ClaudeExe) {
    $ClaudeExe = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
}
if (-not (Test-Path $ClaudeExe)) {
    throw "Could not find claude.exe. Install Claude Code, or add it to PATH."
}

foreach ($d in @($LogDir, $BackupDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$startedAt = Get-Date
$stamp     = $startedAt.ToString('yyyy-MM-dd_HH-mm-ss')
$logFile   = Join-Path $LogDir "igchecker-$stamp.log"

# UTF-8 without BOM. Tee-Object on PS 5.1 writes UTF-16, which makes every log
# un-greppable; the first nine runs of this task are all stored that way.
function Write-Log {
    param([Parameter(ValueFromPipeline = $true)][string]$Text)
    process {
        Write-Host $Text
        [System.IO.File]::AppendAllText($logFile, "$Text`r`n", (New-Object System.Text.UTF8Encoding $false))
    }
}

Set-Location $ProjectDir

# ---------------------------------------------------------------- run state --
# A counter decides which run does the wide sweep. Persisted, because "every
# third run" has to survive reboots and missed days.
$runCount = 0
if (Test-Path $StateFile) {
    try { $runCount = [int](Get-Content $StateFile -Raw | ConvertFrom-Json).run_count } catch { $runCount = 0 }
}
$runCount++
$fullSweep = ($runCount % 3 -eq 0)
$sweepKind = if ($fullSweep) { 'full (Tiers 1-4)' } else { 'tier-1 only' }

"=== IGChecker run $stamp ===" | Write-Log
"Run #$runCount -- sweep: $sweepKind" | Write-Log

# ------------------------------------------------------------------ Chrome --
# Lane A is the primary source and it needs a signed-in Chrome. The Sept 10 run
# was lost purely because Chrome was closed, so start it rather than degrade.
function Start-ChromeIfNeeded {
    if (Get-Process chrome -ErrorAction SilentlyContinue) { return 'already running' }

    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) { return 'unavailable -- chrome.exe not found' }

    Start-Process -FilePath $exe | Out-Null

    # Wait for the process, then give the extension time to complete its
    # handshake. There is no way to confirm that handshake from PowerShell --
    # if it does not land, phase 1 reports Lane A as skipped and the status
    # file records it, which is the honest outcome.
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 2
        if (Get-Process chrome -ErrorAction SilentlyContinue) { break }
    }
    if (-not (Get-Process chrome -ErrorAction SilentlyContinue)) { return 'launch failed' }
    Start-Sleep -Seconds 20
    return 'launched'
}

$chromeState = Start-ChromeIfNeeded
"Chrome: $chromeState" | Write-Log

# ------------------------------------------------------- backup before write --
# changes_since_last_run is computed against this file, so it is the diff
# baseline as well as the data. One bad write would otherwise destroy both.
$backupNote = 'none (no prior findings)'
if (Test-Path $Findings) {
    $backupPath = Join-Path $BackupDir "western_club_findings.$stamp.json"
    Copy-Item $Findings $backupPath -Force
    $backupNote = Split-Path $backupPath -Leaf
    Get-ChildItem $BackupDir -Filter 'western_club_findings.*.json' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $KeepBackups |
        Remove-Item -Force -ErrorAction SilentlyContinue
}
"Backup: $backupNote" | Write-Log

# =========================================================== PHASE 1: sweep ==
$tierLine = if ($fullSweep) {
    'This is a FULL sweep: read Tier 1 first, then Tiers 2, 3 and 4.'
} else {
    'This is a TIER 1 ONLY sweep: read the Tier 1 handles and STOP. Do not sweep ' +
    'Tiers 2-4 -- they are swept every third run and this is not one. Carry their ' +
    'existing entries forward from the previous findings file unchanged.'
}

$sweepPrompt = @"
Run the western-club-events skill (invoke it with the Skill tool) as a SCHEDULED run.

Working directory: the event-compiler folder this run was launched from.

Follow the skill exactly. For this run specifically:
- Set meta.run_type = "scheduled".
- $tierLine
- Record which tiers you swept in meta.tiers_swept.
- Lane A (Instagram) is the PRIMARY source. Attempt it FIRST, using the already-signed-in
  Chrome session via the mcp__claude-in-chrome__* tools. Chrome has already been started for
  you if it was closed. Never enter credentials. If Chrome is unreachable or the session has
  lapsed, skip Lane A, set lane_a_status accordingly, and say so at the TOP of the report so
  the degraded run is obvious.
- Stay strictly READ-ONLY on all sources: no follows, likes, comments, DMs, saves,
  registrations, or form submissions. Only note handles the user is not following in
  not_yet_followed_by_user.
- Always complete Lane B (the web source registry). If a Lane B source fails, record it in
  meta.lane_b_failures rather than dropping it silently.
- Read the existing ./western_club_findings.json first, compute changes_since_last_run
  against it, then overwrite the file.
- Do NOT write to Google Calendar in this phase. A later phase handles that.
- Lead the report with changes_since_last_run. If nothing changed, say exactly that in one
  line and stop.
- Escalate anything time-critical: a deadline within the next 4 days, a newly-confirmed
  O-Week / Clubs Week date, or a first-year application post going live.
"@

# Explicit allowlist: read/fetch/browse + write the one findings file.
# Bash and arbitrary shell execution are deliberately NOT granted -- the node
# step runs in phase 2, from this script, outside the agent's sandbox.
$sweepTools = @(
    'Skill'
    'WebSearch'
    'WebFetch'
    'Read'
    'Write'
    'Edit'
    'Glob'
    'Grep'
    'TodoWrite'
    'mcp__claude-in-chrome'
)

"" | Write-Log
"--- phase 1: sweep ---" | Write-Log

$sweepJson = ''
$sweepCode = 0
try {
    # --output-format json so usage and cost land in the log. Ten previous runs
    # recorded neither, which made "is this expensive?" unanswerable.
    $sweepJson = $sweepPrompt | & $ClaudeExe `
        --print `
        --output-format json `
        --model $Model `
        --chrome `
        --permission-mode acceptEdits `
        --allowedTools $sweepTools `
        --disallowed-tools 'Bash' 'PowerShell' 2>&1 | Out-String
    $sweepCode = $LASTEXITCODE
} catch {
    "ERROR (phase 1): $_" | Write-Log
    $sweepCode = 1
}

$sweepUsage = $null
try {
    $parsed = $sweepJson | ConvertFrom-Json
    $parsed.result | Write-Log
    $sweepUsage = [ordered]@{
        input_tokens          = $parsed.usage.input_tokens
        output_tokens         = $parsed.usage.output_tokens
        cache_read_tokens     = $parsed.usage.cache_read_input_tokens
        cache_creation_tokens = $parsed.usage.cache_creation_input_tokens
        cost_usd              = $parsed.total_cost_usd
        duration_ms           = $parsed.duration_ms
        num_turns             = $parsed.num_turns
    }
    "" | Write-Log
    "usage: in=$($sweepUsage.input_tokens) out=$($sweepUsage.output_tokens) cache_read=$($sweepUsage.cache_read_tokens) cost=`$$($sweepUsage.cost_usd)" | Write-Log
} catch {
    # Not JSON (crashed before producing a result) -- log it raw so nothing is lost.
    $sweepJson | Write-Log
}

# ------------------------------------------------ read back what phase 1 did --
$laneA = 'unknown'; $laneADetail = ''; $handlesRead = 0
$laneB = 'unknown'; $laneBSources = 0; $laneBFailures = @()
$asOf = ''; $tiersSwept = ''

if (Test-Path $Findings) {
    try {
        $f = Get-Content $Findings -Raw | ConvertFrom-Json
        $asOf        = [string]$f.meta.as_of
        $tiersSwept  = [string]$f.meta.tiers_swept
        $laneADetail = [string]$f.meta.lane_a_status
        $handlesRead = @($f.meta.lane_a_handles_read).Count
        $laneBSources = @($f.meta.lane_b_sources_checked).Count
        if ($f.meta.PSObject.Properties.Name -contains 'lane_b_failures') {
            $laneBFailures = @($f.meta.lane_b_failures)
        }

        # Lane A is healthy only if it actually read handles.
        if ($handlesRead -gt 0 -and $laneADetail -notmatch '^(skipped|failed)') { $laneA = 'ok' }
        elseif ($handlesRead -gt 0) { $laneA = 'partial' }
        else { $laneA = 'failed' }

        if ($laneBSources -gt 0 -and $laneBFailures.Count -eq 0) { $laneB = 'ok' }
        elseif ($laneBSources -gt 0) { $laneB = 'partial' }
        else { $laneB = 'failed' }
    } catch {
        "WARN: could not parse findings file: $_" | Write-Log
    }
}

# The distinction you asked for: which lane broke, or both.
if ($sweepCode -ne 0 -and $laneA -eq 'unknown' -and $laneB -eq 'unknown') {
    $outcome = 'launch_failed'
} elseif ($laneA -eq 'failed' -and $laneB -eq 'failed') {
    $outcome = 'both_failed'
} elseif ($laneA -eq 'failed') {
    $outcome = 'lane_a_failed'
} elseif ($laneB -eq 'failed') {
    $outcome = 'lane_b_failed'
} elseif ($laneA -eq 'partial' -or $laneB -eq 'partial') {
    $outcome = 'partial'
} else {
    $outcome = 'ok'
}

"" | Write-Log
"lane A: $laneA ($handlesRead handles) | lane B: $laneB ($laneBSources sources) | outcome: $outcome" | Write-Log

# ============================================================ PHASE 2: plan ==
"" | Write-Log
"--- phase 2: build calendar plan ---" | Write-Log

$planRows = 0; $planFlagged = 0; $planOk = $false
try {
    $planOut = & node $PlanScript 2>&1 | Out-String
    $planOut.TrimEnd() | Write-Log
    if ($LASTEXITCODE -eq 0 -and (Test-Path $PlanFile)) {
        $plan        = Get-Content $PlanFile -Raw | ConvertFrom-Json
        $planRows    = @($plan.rows).Count
        $planFlagged = @($plan.flagged).Count
        $planOk      = $true
    }
} catch {
    "ERROR (phase 2): $_" | Write-Log
}

# ============================================================ PHASE 3: sync ==
$calCreated = 0; $calUpdated = 0; $calSkipped = 0; $syncRan = $false

# Never sync from a run whose data is untrustworthy. A both-lanes failure or a
# crashed sweep means the findings are stale or partial, and writing a calendar
# off them would spread the failure rather than contain it.
if ($planOk -and $planRows -gt 0 -and $outcome -ne 'both_failed' -and $outcome -ne 'launch_failed') {
    "" | Write-Log
    "--- phase 3: sync to Western Clubs calendar ---" | Write-Log

    $syncPrompt = @"
Sync the prepared calendar plan to Google Calendar. This is an UNATTENDED scheduled run:
do not ask for approval, just apply the plan and report counts.

1. Read ./calendar/calendar-plan.json.
2. Write ONLY the entries in its "rows" array. The "flagged" array is report-only --
   those items have unconfirmed or unresolvable dates and must NEVER be written.
3. Target calendar ID: $CalendarId  (the "Western Clubs" calendar -- never the primary).
4. Every row already carries its final summary, ending in " [DASHBOARD]". Write summaries
   EXACTLY as given; do not reword, retitle, or strip the tag.
5. Idempotency: each row has a dashboard_id. Before creating, search the target calendar
   for that id (list_events with fullText) -- if an event carries it, UPDATE that event in
   place; only create when no match exists. The id also belongs on the last line of the
   event description as "dashboard_id: <id>".
6. Apply colorId, timezone, location, description and reminders exactly as the row gives them.
7. NEVER delete a calendar event, even if its source item has vanished. Report it instead.
8. Finish with exact counts: created, updated, skipped, plus anything you refused to write.
"@

    $syncTools = @(
        'Read'
        'Glob'
        'Grep'
        'TodoWrite'
        'mcp__claude_ai_Google_Calendar'
    )

    try {
        $syncJson = $syncPrompt | & $ClaudeExe `
            --print `
            --output-format json `
            --model $Model `
            --permission-mode acceptEdits `
            --allowedTools $syncTools `
            --disallowed-tools 'Bash' 'PowerShell' 'Write' 'Edit' 2>&1 | Out-String
        $syncRan = $true
        try {
            $sp = $syncJson | ConvertFrom-Json
            $sp.result | Write-Log
            if ($sp.result -match 'created[^0-9]{0,12}(\d+)')  { $calCreated = [int]$Matches[1] }
            if ($sp.result -match 'updated[^0-9]{0,12}(\d+)')  { $calUpdated = [int]$Matches[1] }
            if ($sp.result -match 'skipped[^0-9]{0,12}(\d+)')  { $calSkipped = [int]$Matches[1] }
            "" | Write-Log
            "calendar sync cost: `$$($sp.total_cost_usd)" | Write-Log
        } catch {
            $syncJson | Write-Log
        }
    } catch {
        "ERROR (phase 3): $_" | Write-Log
    }
} else {
    "" | Write-Log
    "--- phase 3: SKIPPED (outcome=$outcome, plan rows=$planRows) ---" | Write-Log
}

# ------------------------------------------------------------ status + tidy --
$finishedAt = Get-Date
$status = [ordered]@{
    last_run     = $startedAt.ToString('o')
    finished     = $finishedAt.ToString('o')
    duration_min = [math]::Round(($finishedAt - $startedAt).TotalMinutes, 1)
    run_number   = $runCount
    sweep        = $sweepKind
    tiers_swept  = $tiersSwept
    outcome      = $outcome
    exit_code    = $sweepCode
    chrome       = $chromeState
    as_of        = $asOf
    lane_a       = [ordered]@{ status = $laneA; handles_read = $handlesRead; detail = $laneADetail }
    lane_b       = [ordered]@{ status = $laneB; sources_checked = $laneBSources; failures = $laneBFailures }
    calendar     = [ordered]@{ synced = $syncRan; planned = $planRows; created = $calCreated; updated = $calUpdated; skipped = $calSkipped; flagged = $planFlagged }
    usage        = $sweepUsage
    backup       = $backupNote
    log          = Split-Path $logFile -Leaf
}
# UTF-8 WITHOUT a BOM, the same reason the log writer above avoids Tee-Object:
# `Set-Content -Encoding utf8` on PS 5.1 always emits a BOM, and the dashboard
# reads this file with fs.readFileSync(p, "utf8") + JSON.parse, which keeps the
# BOM and throws on it. Its catch reported that as "no run-status.json yet", so
# a perfectly good status file rendered as "Last run: unknown".
# .run-state.json below can keep Set-Content: only PowerShell reads it back, and
# ConvertFrom-Json tolerates the BOM.
[System.IO.File]::WriteAllText(
    $StatusFile,
    ($status | ConvertTo-Json -Depth 6),
    (New-Object System.Text.UTF8Encoding $false)
)

@{ run_count = $runCount } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8

"" | Write-Log
"=== exit $sweepCode at $($finishedAt.ToString('yyyy-MM-dd HH:mm:ss')) -- outcome: $outcome ===" | Write-Log

# Keep only the most recent $KeepLogs runs.
Get-ChildItem $LogDir -Filter 'igchecker-*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $KeepLogs |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $sweepCode
