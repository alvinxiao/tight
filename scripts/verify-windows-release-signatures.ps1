param([Parameter(Mandatory = $true)][string]$AppDirectory, [Parameter(Mandatory = $true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
foreach ($file in @((Join-Path $AppDirectory 'TIGHT.exe'), $InstallerPath)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') { throw "Release requires a valid publisher signature: $file" }
}
