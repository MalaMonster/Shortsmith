# Creates a synthetic 25 s "gaming recording" for testing: gameplay test pattern, a facecam box in the
# bottom-left, and two TTS voices (two speakers, overlapping around 8.5-9.3 s) on separate audio tracks:
#   track 1 = mix, track 2 = speaker A only, track 3 = speaker B only   (like an OBS multi-track recording)
$ErrorActionPreference = "Stop"
$out = Join-Path $PSScriptRoot "..\data\testmedia"; New-Item -ItemType Directory -Force $out | Out-Null
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice("Microsoft David Desktop"); $s.SetOutputToWaveFile("$out\a.wav")
$s.Speak("Okay, here we go. This is the hardest level in the game and I am going to beat it right now. Watch this jump, it is going to be perfect.")
$s.SelectVoice("Microsoft Zira Desktop"); $s.SetOutputToWaveFile("$out\b.wav")
$s.Speak("No way, you are going to die on the saw blade again. Just go, just go! Get the coin first."); $s.SetOutputToNull()
$font = "fontfile='C\:/Windows/Fonts/arialbd.ttf'"
$fc = "[1:v]drawtext=${font}:text='FACECAM':fontsize=60:fontcolor=white:box=1:boxcolor=black@0.6:x=(w-tw)/2:y=20,drawbox=c=red:t=6[cam];" +
      "[0:v]drawtext=${font}:text='GAMEPLAY %{pts\:hms}':fontsize=70:fontcolor=yellow:box=1:boxcolor=black@0.6:x=700:y=60[g];[g][cam]overlay=30:690,format=yuv420p[v];" +
      "[2:a]aresample=48000,adelay=1000:all=1,apad=whole_dur=25[a1];[3:a]aresample=48000,adelay=8500:all=1,apad=whole_dur=25[b1];" +
      "[a1]asplit[a1x][a1y];[b1]asplit[b1x][b1y];[a1x][b1x]amix=inputs=2:normalize=0[mix]"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=1920x1080:r=30:d=25" -f lavfi -i "smptehdbars=s=480x360:r=30:d=25" `
  -i "$out\a.wav" -i "$out\b.wav" -filter_complex $fc -map "[v]" -map "[mix]" -map "[a1y]" -map "[b1y]" `
  -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 160k -t 25 "$out\test_multitrack.mkv"
ffmpeg -hide_banner -loglevel error -y -i "$out\test_multitrack.mkv" -map 0:v -map 0:a:0 -c copy "$out\test_stream.mp4"
Write-Host "Created $out\test_multitrack.mkv and test_stream.mp4"
