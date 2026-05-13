# BLADE installer - Windows (PowerShell 5.1+).
# Detects architecture, fetches the latest GitHub release manifest (CDN fallback for proxied networks),
# downloads the matching asset (.msi preferred, .exe fallback), verifies SHA256 when sibling published,
# installs silently, and launches BLADE.
# Preserves %LOCALAPPDATA%\Blade user data (blade.db, who-you-are.md, Credential Manager) across upgrades.
# Safe to audit: iwr -useb slayerblade.site/install.ps1 -OutFile install.ps1 ; notepad install.ps1

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Version = ""
)

$ErrorActionPreference = 'Stop'

# --- constants ----------------------------------------------------------------
$GitHubRepo  = 'sb-arnav/BLADE'
$GitHubApi   = "https://api.github.com/repos/$GitHubRepo/releases/latest"
$CdnBase     = 'https://cdn.slayerblade.site/releases'

# Force TLS 1.2 on older PowerShell 5.1.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

# --- ui helpers ---------------------------------------------------------------
function Write-Log  { param($m) Write-Host "[blade] $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "[blade] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "[blade] $m" -ForegroundColor Yellow }
function Die        { param($m) Write-Host "[blade] $m" -ForegroundColor Red; exit 1 }

# --- platform detection -------------------------------------------------------
function Get-BladeArch {
    $procArch = $env:PROCESSOR_ARCHITECTURE
    # PROCESSOR_ARCHITEW6432 is set when a 32-bit shell runs on a 64-bit OS.
    if ($env:PROCESSOR_ARCHITEW6432) { $procArch = $env:PROCESSOR_ARCHITEW6432 }

    switch -Regex ($procArch) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        'x86'   { return 'x86' }
        default { Die "Unsupported processor architecture: $procArch" }
    }
}

# --- release manifest ---------------------------------------------------------
function Get-ReleaseJson {
    $url = $GitHubApi
    if ($Version) {
        $url = "https://api.github.com/repos/$GitHubRepo/releases/tags/$Version"
    }
    try {
        return Invoke-RestMethod -Uri $url -UseBasicParsing -Headers @{ 'User-Agent' = 'blade-installer' } -TimeoutSec 30
    } catch {
        Die "Could not reach GitHub Releases API: $($_.Exception.Message)"
    }
}

function Find-AssetUrl {
    param($Json, [string]$Suffix)
    $asset = $Json.assets | Where-Object { $_.name.EndsWith($Suffix) } | Select-Object -First 1
    if (-not $asset) { return $null }
    return @{
        Name = $asset.name
        Url  = $asset.browser_download_url
    }
}

# --- download with CDN fallback (INSTALL-07) ----------------------------------
function Invoke-Download {
    param(
        [string]$PrimaryUrl,
        [string]$Version,
        [string]$AssetName,
        [string]$OutPath
    )

    Write-Log "Downloading $AssetName..."
    try {
        Invoke-WebRequest -Uri $PrimaryUrl -OutFile $OutPath -UseBasicParsing -TimeoutSec 600
        return
    } catch {
        Write-Warn "GitHub download failed; trying CDN mirror..."
    }

    $cdnUrl = "$CdnBase/$Version/$AssetName"
    try {
        Invoke-WebRequest -Uri $cdnUrl -OutFile $OutPath -UseBasicParsing -TimeoutSec 600
        Write-Ok "CDN mirror download succeeded"
    } catch {
        Die "Failed to download $AssetName from GitHub and CDN. Check your network or open an issue."
    }
}

# --- checksum -----------------------------------------------------------------
function Test-Checksum {
    param(
        [string]$FilePath,
        $Json,
        [string]$AssetName
    )

    $sumAsset = Find-AssetUrl -Json $Json -Suffix "$AssetName.sha256"
    if (-not $sumAsset) {
        Write-Warn "No .sha256 sibling published for $AssetName - skipping checksum verify."
        return
    }

    Write-Log "Verifying SHA256 checksum..."
    try {
        $expected = (Invoke-WebRequest -Uri $sumAsset.Url -UseBasicParsing -TimeoutSec 30).Content
        $expected = ($expected -split '\s+')[0].Trim()
    } catch {
        Write-Warn "Checksum file unreachable - skipping verify."
        return
    }

    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()
    if ($expected.ToLower() -ne $actual) {
        Die "Checksum mismatch: expected $expected, got $actual"
    }
    Write-Ok "Checksum OK ($actual)"
}

# --- install ------------------------------------------------------------------
function Install-Blade {
    param($Json, [string]$Arch, [string]$Version, [string]$Mode)

    # Asset preference: .msi (cleaner uninstall + Group Policy friendly), else .exe NSIS installer.
    $archTag = switch ($Arch) {
        'x64'   { 'x64' }
        'arm64' { 'arm64' }
        default { Die "No Windows asset for arch: $Arch" }
    }

    $msi = Find-AssetUrl -Json $Json -Suffix "${archTag}_en-US.msi"
    $exe = Find-AssetUrl -Json $Json -Suffix "${archTag}-setup.exe"

    $chosen = $msi
    $kind   = 'msi'
    if (-not $chosen) {
        $chosen = $exe
        $kind   = 'exe'
    }
    if (-not $chosen) {
        Die "No matching Windows asset (.msi or .exe) for arch $archTag in release $Version"
    }

    $tmpDir = Join-Path $env:TEMP ("blade-install-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $outFile = Join-Path $tmpDir $chosen.Name

    if ($DryRun) {
        Write-Log "[dry-run] Would download $($chosen.Url) -> $outFile"
        Write-Log "[dry-run] Would install via $kind"
        return
    }

    try {
        Invoke-Download -PrimaryUrl $chosen.Url -Version $Version -AssetName $chosen.Name -OutPath $outFile
        Test-Checksum -FilePath $outFile -Json $Json -AssetName $chosen.Name

        Write-Log "$Mode BLADE (user data in %LOCALAPPDATA%\Blade preserved)..."

        if ($kind -eq 'msi') {
            $args = @('/i', "`"$outFile`"", '/quiet', '/norestart')
            $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Wait -PassThru
            if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
                Die "msiexec exited with code $($p.ExitCode)"
            }
        } else {
            # NSIS silent install flag.
            $p = Start-Process -FilePath $outFile -ArgumentList '/S' -Wait -PassThru
            if ($p.ExitCode -ne 0) {
                Die "Installer exited with code $($p.ExitCode)"
            }
        }
    } finally {
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Ok "$Mode complete - launching BLADE..."
    $bladeExe = Join-Path $env:LOCALAPPDATA 'Programs\Blade\Blade.exe'
    if (Test-Path $bladeExe) {
        Start-Process -FilePath $bladeExe
    } else {
        # Try Start Menu shortcut as a fallback.
        $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Blade.lnk'
        if (Test-Path $startMenu) {
            Start-Process -FilePath $startMenu
        } else {
            Write-Warn "Couldn't auto-launch BLADE. Start it from the Start Menu."
        }
    }
}

# --- main ---------------------------------------------------------------------
function Main {
    $arch = Get-BladeArch
    Write-Log "OS: windows  Arch: $arch"

    # Upgrade detection - check the canonical install path.
    $bladeExe = Join-Path $env:LOCALAPPDATA 'Programs\Blade\Blade.exe'
    $mode = if (Test-Path $bladeExe) { 'Upgrading' } else { 'Installing' }
    Write-Log "$mode BLADE."

    Write-Log "Fetching release manifest..."
    $json = Get-ReleaseJson
    $tag  = $json.tag_name
    if (-not $tag) { Die "Could not parse release tag from API response." }
    Write-Log "Target version: $tag"

    Install-Blade -Json $json -Arch $arch -Version $tag -Mode $mode

    Write-Host ""
    Write-Host " BLADE $tag installed." -ForegroundColor Green
    Write-Host "   Docs:  https://github.com/$GitHubRepo" -ForegroundColor DarkGray
    Write-Host "   Data:  %LOCALAPPDATA%\Blade (untouched on upgrade)" -ForegroundColor DarkGray
    Write-Host ""
}

Main
