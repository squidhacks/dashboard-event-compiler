<#
    run_igchecker.ps1 — scheduled "every other day" run of the western-club-events skill.

    Registered with Windows Task Scheduler as "IGChecker - Western Events".
    Runs only while the user is logged on, so the Claude-in-Chrome integration can
    reach the already-signed-in Instagram session (Lane A of the skill).

    Re-register / inspect:  see setup_igchecker_task.ps1
    Logs:                   .\logs\igchecker-<timestamp>.log
#>

$ErrorActionPreference = 'Stop'

# Everything is relative to this script, so the checkout can live anywhere.
$ProjectDir = $PSScriptRoot

# Prefer claude.exe on PATH; fall back to the default per-user install location.
$ClaudeExe = (Get-Command claude.exe -ErrorAction SilentlyContinue).Source
if (-not $ClaudeExe) {
    $ClaudeExe = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
}
if (-not (Test-Path $ClaudeExe)) {
    throw "Could not find claude.exe. Install Claude Code, or add it to PATH."
}
$LogDir     = Join-Path $ProjectDir 'logs'
$KeepLogs   = 20

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$stamp   = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$logFile = Join-Path $LogDir "igchecker-$stamp.log"

Set-Location $ProjectDir

$prompt = @'
Run the western-club-events skill (invoke it with the Skill tool) as a SCHEDULED run.

Working directory: the event-compiler folder this run was launched from.

Follow the skill exactly. For this run specifically:
- Set meta.run_type = "scheduled".
- Lane A (Instagram) is the PRIMARY source. Attempt it FIRST, using the already-signed-in
  Chrome session via the mcp__claude-in-chrome__* tools, sweeping Tier 1 handles first.
  Never enter credentials. If Chrome is unreachable or the session has lapsed, skip Lane A,
  set lane_a_status accordingly, and say so at the TOP of the report so the degraded run is
  obvious.
- Stay strictly READ-ONLY: no follows, likes, comments, DMs, saves, registrations, or form
  submissions. Only note handles the user is not following in not_yet_followed_by_user.
- Always complete Lane B (the web source registry).
- Read the existing ./western_club_findings.json first, compute changes_since_last_run
  against it, then overwrite the file.
- Lead the report with changes_since_last_run. If nothing changed, say exactly that in one
  line and stop.
- Escalate anything time-critical: a deadline within the next 4 days, a newly-confirmed
  O-Week / Clubs Week date, or a first-year application post going live.
'@

# Explicit allowlist: read/fetch/browse + write the one findings file.
# Bash and arbitrary shell execution are deliberately NOT granted.
$allowed = @(
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

"=== IGChecker run $stamp ===" | Tee-Object -FilePath $logFile

# The prompt goes in on stdin, not as a positional arg: it would otherwise be
# swallowed by the preceding variadic --disallowed-tools option.
try {
    $prompt | & $ClaudeExe `
        --print `
        --chrome `
        --permission-mode acceptEdits `
        --allowedTools $allowed `
        --disallowed-tools 'Bash' 'PowerShell' 2>&1 |
        Tee-Object -FilePath $logFile -Append

    $code = $LASTEXITCODE
} catch {
    "ERROR: $_" | Tee-Object -FilePath $logFile -Append
    $code = 1
}

"=== exit $code at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" |
    Tee-Object -FilePath $logFile -Append

# Keep only the most recent $KeepLogs runs.
Get-ChildItem $LogDir -Filter 'igchecker-*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $KeepLogs |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
