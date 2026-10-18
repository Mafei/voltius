param([string]$Binary, [string]$BundleDirectory, [string]$Evidence)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Evidence | Out-Null
$Binary = (Resolve-Path $Binary).Path
$stream = [IO.File]::OpenRead($Binary)
$reader = [IO.BinaryReader]::new($stream)
try {
  $stream.Position = 0x3c; $offset = $reader.ReadInt32()
  $stream.Position = $offset; if ($reader.ReadUInt32() -ne 0x4550) { throw 'Invalid PE signature' }
  if ($reader.ReadUInt16() -ne 0x8664) { throw 'Expected AMD64 PE machine' }
} finally { $reader.Dispose(); $stream.Dispose() }
$signature = Get-AuthenticodeSignature $Binary
if ($signature.Status -ne 'NotSigned') { throw 'Test executable unexpectedly has an Authenticode identity' }
$version = (Get-Item $Binary).VersionInfo
$sha = (git rev-parse HEAD).Trim()
$applicationVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
if (!$version.ProductVersion.StartsWith($applicationVersion)) { throw "Unexpected PE version" }
$name = "Voltius_${applicationVersion}_$($sha.Substring(0,8))_windows-x64-unsigned-test.exe"
Copy-Item $Binary (Join-Path $Evidence $name)
Get-ChildItem $BundleDirectory -Recurse -File | Where-Object { $_.Extension -in '.exe','.msi' } | ForEach-Object { Copy-Item $_.FullName $Evidence }
Copy-Item LICENSE,NOTICE.md $Evidence
Copy-Item docs/desktop-session-test.md (Join-Path $Evidence 'BUILD-NOTICE.md')
git archive --format=zip --output="$Evidence/sources.zip" HEAD -- . ':!keystore' ':!keystore/**'
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed' }
$process = Start-Process -FilePath $Binary -PassThru -RedirectStandardOutput "$Evidence/launch-stdout.log" -RedirectStandardError "$Evidence/launch-stderr.log"
$launch = @{ running = $false; visibleWindow = $false; scope = 'Normal cloud-runner process launch; no installation or OS policy changes' }
try {
  Start-Sleep -Seconds 15; $process.Refresh()
  $launch.running = !$process.HasExited
  if ($process.HasExited) { throw "Voltius exited during cloud launch: $($process.ExitCode)" }
  $launch.visibleWindow = $process.MainWindowHandle -ne 0
  $launch.responding = $process.Responding
  try {
    Add-Type -AssemblyName System.Windows.Forms,System.Drawing
    $bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds
    $image = [Drawing.Bitmap]::new($bounds.Width,$bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($image)
    try { $graphics.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size); $image.Save("$Evidence/launch.png") }
    finally { $graphics.Dispose(); $image.Dispose() }
  } catch { $_.Exception.Message | Set-Content "$Evidence/screenshot-error.txt" }
} finally { if (!$process.HasExited) { Stop-Process -Id $process.Id }; $launch | ConvertTo-Json -Depth 5 | Set-Content "$Evidence/launch.json" }
$files = Get-ChildItem $Evidence -File | Where-Object { $_.Extension -in '.exe','.msi','.zip' }
$hashes = @($files | ForEach-Object { @{ file = $_.Name; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length } })
$hashes | ForEach-Object { "$($_.sha256)  $($_.file)" } | Set-Content "$Evidence/SHA256SUMS"
@{ source_sha=$sha; application_baseline='830ee0ce308560de1651755d46e53f88866659ee'; version=$applicationVersion;
  architecture='x86_64'; pe_product_version=$version.ProductVersion; signing='unsigned; Authenticode NotSigned; no private key';
  launch=$launch; files=$hashes; unverified=@('user-machine SmartScreen','native keyboard/IME interaction','real-host SSH/SFTP','Windows agent runtime signing')
} | ConvertTo-Json -Depth 8 | Set-Content "$Evidence/BUILD-MANIFEST.json"
Get-Content "$Evidence/BUILD-MANIFEST.json"
