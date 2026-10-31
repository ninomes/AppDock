param(
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'SilentlyContinue'
$dirs = @(
  ([Environment]::GetFolderPath('CommonStartMenu') + '\Programs'),
  ([Environment]::GetFolderPath('StartMenu') + '\Programs')
)
$sh = New-Object -ComObject WScript.Shell
$sb = New-Object System.Text.StringBuilder
foreach ($d in $dirs) {
  if (-not (Test-Path -LiteralPath $d)) { continue }
  $files = Get-ChildItem -LiteralPath $d -Filter *.lnk -Recurse -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    $l = $sh.CreateShortcut($f.FullName)
    $o = [pscustomobject]@{
      path    = $f.FullName
      name    = $f.BaseName
      target  = $l.TargetPath
      args    = $l.Arguments
      workdir = $l.WorkingDirectory
      icon    = $l.IconLocation
      desc    = $l.Description
    }
    [void]$sb.AppendLine(($o | ConvertTo-Json -Compress -Depth 3))
  }
}
[System.IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
