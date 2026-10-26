# JUSTZ Studio

Lokale Video-Schnittsoftware von **JUSTZ Media Works**. Talking-Head-Videos und Kundenmaterial werden in Minuten zu postfertigen Reels: Pausen raus, Untertitel drauf, Hook rein, Musik drunter, Export für Instagram/TikTok.

Alles läuft lokal auf dem Rechner (macOS oder Windows). Videos und Transkripte verlassen den Rechner nicht. Internet braucht ihr nur einmalig für das Whisper-Modell.

---

## Installation auf macOS

### 1. Homebrew (falls noch nicht da)

Terminal öffnen und ausführen:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Am Ende zeigt Homebrew zwei Befehle an (`echo … >> ~/.zprofile` und `eval …`). Diese bitte ausführen und das Terminal neu öffnen.

### 2. Node.js, FFmpeg und whisper.cpp

```bash
brew install node ffmpeg whisper-cpp git
```

Prüfen:

```bash
node -v                                   # v20 oder neuer
ffmpeg -hide_banner -filters | grep -E " (subtitles|zscale|loudnorm) "
whisper-cli --help | head -3
```

Beim FFmpeg-Check müssen **subtitles**, **zscale** und **loudnorm** auftauchen. Fehlt einer davon, installiert die volle Version (die App findet sie automatisch):

```bash
brew install ffmpeg-full
```

### 3. App holen und starten

```bash
git clone https://github.com/schmittjustin301-svg/justz-studio.git
cd justz-studio
npm install
npm run dev
```

Das App-Fenster öffnet sich. Unter ⚙ **Einstellungen** sollten FFmpeg, FFprobe und whisper.cpp mit grünem Punkt stehen.

### 4. Whisper-Modell laden (einmalig)

Unter ⚙ **Einstellungen → Whisper-Modelle** auf **Laden** klicken:

| Modell | Größe | Empfehlung |
|---|---|---|
| Small | 466 MB | Standard, läuft auf jedem Mac |
| Large v3 Turbo (komprimiert) | 547 MB | Beste Qualität, empfohlen für Apple Silicon (M1–M4) |
| Base | 142 MB | Nur zum schnellen Testen |
| Medium | 1,5 GB | Genauer als Small, langsamer |

Die Modelle liegen danach in `~/Library/Application Support/JUSTZ Studio/models`. Wenn ihr beim ersten Transkribieren noch kein Modell habt, fragt die App automatisch nach.

### 5. Logo

`logo.png` (Chrom-Schriftzug) in den Projektordner legen, also neben diese README. Die App zeigt es dann oben links an. Ohne Datei erscheint ein nachgebauter Schriftzug.

### Als eigene Mac-App bauen (optional)

```bash
npm run dist:mac
```

Die DMG liegt danach in `release/`. Die App ist nicht von Apple signiert. Beim ersten Öffnen deshalb **Rechtsklick → Öffnen → Öffnen**.

## Installation auf Windows (10/11)

Alle Befehle in der **PowerShell** ausführen: Start-Menü → „PowerShell“ eintippen → Enter.

### 1. Node.js, Git und FFmpeg

```powershell
winget install OpenJS.NodeJS.LTS Git.Git Gyan.FFmpeg
```

Danach die PowerShell **schließen und neu öffnen**, damit die neuen Programme gefunden werden. Prüfen:

```powershell
node -v
ffmpeg -hide_banner -version
```

### 2. whisper.cpp (für die Transkription)

1. [github.com/ggml-org/whisper.cpp/releases](https://github.com/ggml-org/whisper.cpp/releases) öffnen und beim neuesten Release die Datei **`whisper-bin-x64.zip`** herunterladen.
2. Den Inhalt nach **`C:\whisper`** entpacken. Am Ende muss es die Datei `C:\whisper\Release\whisper-cli.exe` oder `C:\whisper\whisper-cli.exe` geben.

Die App sucht dort automatisch. Liegt die Datei woanders, tragt den Pfad unter ⚙ → „Eigene Programmpfade“ ein.

### 3. App holen und starten

```powershell
git clone https://github.com/schmittjustin301-svg/justz-studio.git $HOME\justz-studio
cd $HOME\justz-studio
npm install
npm run dev
```

Beim `git clone` öffnet sich ein GitHub-Anmeldefenster, weil das Repo privat ist. Einfach im Browser anmelden.

Danach unter ⚙ **Einstellungen** das Whisper-Modell laden, siehe Schritt 4 bei macOS. Die Modelle liegen unter Windows in `%APPDATA%\JUSTZ Studio\models`.

**Als installierbare Windows-App bauen (optional):** `npm run dist:win`. Der Installer liegt danach in `release\`. Windows warnt beim ersten Start, weil die App nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.

---

## So arbeitet ihr damit

1. **Video reinziehen**: MP4/MOV, auch direkt vom iPhone (HEVC, HDR, 60 fps, hochkant). Die App baut eine flüssige Vorschau und erkennt die Pausen sofort.
2. **SCHNITT**: Mit Schwelle, Mindestpause und Luft regelt ihr, wie hart geschnitten wird. In der Timeline schaltet ein Klick einen Schnitt an oder aus.
3. **UNTERTITEL → Transkribieren**: Die App erzeugt Blöcke mit 2–4 Wörtern.
   - Wort anklicken: Schlüsselwort (rot) an/aus.
   - ✎ oder Doppelklick: Text korrigieren. Schlüsselwörter schreibt ihr in `*Sternchen*`.
   - Das Timing bleibt beim Korrigieren erhalten.
4. **STIL & HOOK**: Kunden-Preset wählen (z. B. **Rafael**), anpassen und speichern. Neue Presets legt ihr unter „Name für neues Preset“ an. Den Hook-Text eintippen, er erscheint als roter Balken in den ersten Sekunden.
5. **FORMAT & TON**:
   - 9:16 / 4:5 / 16:9 wählen, entweder zugeschnitten oder eingepasst mit Blur-Hintergrund.
   - Ausschnitt mit Zoom und Verschieben festlegen.
   - Musik auswählen: Sie wird automatisch leiser, wenn gesprochen wird.
6. **Exakte Vorschau** (oder Doppelklick auf das Bild) rendert das aktuelle Bild genau so, wie es im Export aussieht.
7. **Export** (⌘E) erzeugt MP4 H.264 + AAC, Lautheit auf -14 LUFS normalisiert.
8. **Speichern** (⌘S) legt eine `.justz`-Projektdatei an. Liegen Projekt und Video zusammen im Ordner, dürfen beide gemeinsam verschoben werden.

**BATCH**: Mehrere Rohvideos oder Projekte reinziehen. Rohvideos laufen automatisch durch Pausenschnitt, Transkription, Untertitel (mit gewähltem Preset) und Export.

**Tastatur**

| Taste | Funktion |
|---|---|
| Leertaste | Abspielen / Pause |
| ← / → | 1 s springen (mit ⇧: 5 s) |
| ⌘Z / ⇧⌘Z | Rückgängig / Wiederholen |
| ⌘S | Speichern |
| ⌘E | Export |
| ⌘O | Projekt öffnen |

---

## Meilensteine & wie ihr sie testet

| # | Inhalt | Test |
|---|---|---|
| M0 | App-Gerüst, Branding, Tool-Check | `npm run dev` startet die App; ⚙ zeigt grüne Punkte |
| M1 | Import, Vorschau, Projekt speichern/öffnen | iPhone-Video reinziehen: richtig hochkant, flüssig. ⌘S, App schließen, Projekt wieder öffnen |
| M2 | Auto-Pausenschnitt + Timeline | Play: Pausen werden übersprungen. Regler bewegen: Schnitte ändern sich live. Schnitt anklicken: aus |
| M3 | Transkription | UNTERTITEL → Transkribieren (DE und EN probieren) |
| M4 | Untertitel, Presets, Hook | Wort korrigieren, Schlüsselwort setzen, Preset „Rafael“, Hook-Text. „Exakte Vorschau“ vergleichen |
| M5 | Format, Musik, Export, Batch | Export aufs Handy schicken. 4:5/16:9 + Blur testen. Musik + Ducking. Batch mit 2–3 Videos |

Automatische Tests (Engine + echte FFmpeg-Exports mit erzeugten Testclips):

```bash
npm test
npm run typecheck
```

---

## Architektur

```
src/
  engine/      Reine Logik ohne Electron/Node – vollständig testbar
    types.ts       Datenmodell (Projekt, Schnitte, Wörter, Presets …)
    media.ts       ffprobe-Auswertung: Rotation, HDR, fps
    silence.ts     Lautstärkeverlauf → Pausen → Schnitte (Schwelle, Mindestpause, Luft)
    timeline.ts    Quellzeit ↔ Ausgabezeit nach den Schnitten
    transcript.ts  whisper.cpp-JSON → Wörter mit Zeitstempeln
    captions.ts    Wörter → Blöcke (2–4 Wörter), Korrektur mit Timing-Erhalt, Schlüsselwörter
    presets.ts     Caption-Presets (JUSTZ Standard, Rafael, Clean Karaoke)
    ass.ts         Untertitel + Hook als ASS-Datei für libass
    render.ts      FFmpeg-Filtergraph: Schnitt, Crop/Blur, HDR→SDR, Untertitel, Ducking, Loudnorm
  node/        Node-Dienste: FFmpeg/whisper starten, Analyse-Cache, Export, Projektdateien
  main/        Electron-Hauptprozess: Fenster, Menü, Dialoge, IPC, lokales Medien-Protokoll
  preload/     sichere Brücke zwischen Oberfläche und Hauptprozess
  shared/      gemeinsame IPC-Typen
  renderer/    React-Oberfläche
resources/fonts  TTF-Schriften für das Einbrennen (Anton, Montserrat)
tests/           Vitest: Engine-Unit-Tests + Pipeline-Tests mit echtem FFmpeg
```

**Wie der Export funktioniert**
- **Schnitt:** Die Schnitte werden aufs Bildraster gerundet. Bild und Ton werden mit `select`/`aselect` in exakt gleich großen Stücken ausgewählt, so bleibt die Lippensynchronität auch nach vielen Schnitten erhalten.
- **Untertitel und Hook:** Sie werden als ASS-Datei in Ausgabezeit erzeugt und mit libass eingebrannt. Schriftgrößen werden umgerechnet, damit die Live-Vorschau und der Export gleich aussehen.
- **iPhone-HDR (HLG/Dolby Vision):** Das Material wird mit `zscale`/`tonemap` nach SDR (BT.709) umgerechnet, sonst wirkt es auf Instagram blass.
- **Musik:** `sidechaincompress` mit der Stimme als Steuersignal (Ducking), Einblenden am Anfang, Ausblenden am Ende.
- **Lautheit:** zweistufiges `loudnorm`, also erst messen, dann linear auf -14 LUFS / -1 dBTP.
- **Ausgabe:** H.264 High (CRF 19 bzw. 16), AAC 192 kbit/s 48 kHz, `+faststart`.

**Wo die Daten liegen** (Mac: `~/Library/Application Support/JUSTZ Studio/`, Windows: `%APPDATA%\JUSTZ Studio\`)
- `settings.json`: Einstellungen
- `presets.json`: eure Kunden-Presets
- `models/`: Whisper-Modelle
- `cache/`: Vorschau-Proxys und Analysen. Darf jederzeit gelöscht werden, sie werden neu erzeugt.

---

## Fehlerbehebung

- **„FFmpeg wurde nicht gefunden“**: `brew install ffmpeg`. Liegt FFmpeg woanders, tragt den Pfad unter ⚙ → „Eigene Programmpfade“ ein.
- **„Filter subtitles fehlt“ / HDR-Videos blass**: `brew install ffmpeg-full`, danach die App neu starten.
- **Transkription bricht ab**: Prüft, ob `whisper-cli --help` im Terminal läuft. Bei wenig Arbeitsspeicher das Modell „Small“ nehmen.
- **Ton und Bild verschoben**: Das sollte nicht vorkommen. Bitte das Originalvideo und die `.justz`-Datei aufheben und melden.

## Später geplant

Auto-Reframing aufs Gesicht, Füllwörter („ähm“) entfernen, B-Roll-Vorschläge, Captions + Hashtags per Claude-API, Karussell-Cover-Templates, mehrere Clips pro Projekt.
