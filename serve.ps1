<#
.SYNOPSIS
  Serves Quanta on http://localhost:<port>/ and opens it in Edge (app window) or your default browser.
  Zero dependencies: uses the .NET HttpListener that ships with Windows PowerShell.
  Only files inside this folder are served, only to this machine (localhost).

.PARAMETER Port
  First port to try (default 8477). The next 20 ports are tried if it is busy.
.PARAMETER NoBrowser
  Do not open a browser window; just serve.
#>
param(
  [int]$Port = 8477,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.mp3'  = 'audio/mpeg'
  '.ogg'  = 'audio/ogg'
  '.wav'  = 'audio/wav'
  '.flac' = 'audio/flac'
}

# Find a free port, starting at -Port.
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break } catch { $l.Close() }
}
if (-not $listener) { Write-Error "Could not open any port between $Port and $($Port + 19)."; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  Quanta is running at $url" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C in this window to stop." -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  $edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { Start-Process $edge "--app=$url" } else { Start-Process $url }
}

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    # Poll instead of blocking so Ctrl+C is honoured.
    while (-not $task.Wait(250)) { }
    $ctx = $task.Result
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($path -eq '/') { $path = '/index.html' }
      $rel = $path.TrimStart('/') -replace '/', '\'
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      $inside = $full.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
      if (-not $inside -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("404 - not found: $path")
        $res.ContentType = 'text/plain; charset=utf-8'
      } else {
        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = 'application/octet-stream' }
        $res.Headers['Cache-Control'] = 'no-cache'
        $bytes = [IO.File]::ReadAllBytes($full)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      try { $res.StatusCode = 500 } catch { }
    } finally {
      try { $res.Close() } catch { }
    }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch { }
}
