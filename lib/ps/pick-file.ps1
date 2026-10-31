param(
  [string]$Filter = '程序 (*.exe;*.lnk;*.bat;*.cmd)|*.exe;*.lnk;*.bat;*.cmd|所有文件 (*.*)|*.*',
  [string]$Title = '选择程序',
  [Parameter(Mandatory = $true)][string]$Out
)
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = $Filter
$dlg.Title = $Title
$dlg.CheckFileExists = $true
$dlg.Multiselect = $false
$result = ''
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $result = $dlg.FileName
}
[System.IO.File]::WriteAllText($Out, $result, (New-Object System.Text.UTF8Encoding($false)))
