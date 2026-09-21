param(
    [Parameter(Mandatory=$true)][string]$Payload,
    [Parameter(Mandatory=$true)][string]$SevenZip,
    [Parameter(Mandatory=$true)][string]$Output,
    [string]$TemporaryDirectory
)
$ErrorActionPreference = 'Stop'
$Payload = (Resolve-Path -LiteralPath $Payload).Path
$SevenZip = (Resolve-Path -LiteralPath $SevenZip).Path
$Output = [IO.Path]::GetFullPath($Output)
# This launcher deliberately reuses the tested Desktop 2.0.5 online payload.
$expected = '5e2e365397638d61f202753b5dbcee1d9dbd377a5a9d17c160535891f187decd'
if ((Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Unexpected payload. Review and update the launcher runtime version before changing the payload.'
}
$directory = Split-Path -Parent $Output
New-Item -ItemType Directory -Force $directory | Out-Null
$buildTemp = if ($TemporaryDirectory) { [IO.Path]::GetFullPath($TemporaryDirectory) } else { Join-Path $directory 'build-temp' }
New-Item -ItemType Directory -Force $buildTemp | Out-Null
$oldTemp = $env:TEMP; $oldTmp = $env:TMP
try {
    $env:TEMP = $buildTemp; $env:TMP = $buildTemp
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $patch = Join-Path $PSScriptRoot 'patch-runtime.cjs'
    $packageHelper = Join-Path $PSScriptRoot '../../bin/desktop-package-manager.mjs'
    & $compiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Xml.Linq.dll "/out:$Output" "/resource:$Payload,payload" "/resource:$SevenZip,seven" "/resource:$patch,runtimePatch" "/resource:$packageHelper,packageHelper" (Join-Path $PSScriptRoot 'Launcher.cs') (Join-Path $PSScriptRoot 'SetupDialog.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
    Get-FileHash -LiteralPath $Output -Algorithm SHA256
} finally {
    $env:TEMP = $oldTemp; $env:TMP = $oldTmp
    # Delete only an empty compiler temp directory, never arbitrary build files.
    if ([IO.Directory]::Exists($buildTemp) -and [IO.Directory]::GetFileSystemEntries($buildTemp).Length -eq 0) { [IO.Directory]::Delete($buildTemp) }
}
