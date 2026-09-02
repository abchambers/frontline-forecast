# Radar decode benchmark

Answers one question: how fast does *this* machine decode a real NEXRAD radar volume, compared to
the current Fly.io worker? No networking setup, no exposure to the internet — this only downloads
public NOAA radar data and times the decode, nothing else.

## What you need first: Node.js

If you don't already have it, install Node from https://nodejs.org — pick the "LTS" version. This
works the same way on Windows and Mac.

To check if you already have it, open a terminal (Mac: Terminal app; Windows: PowerShell) and run:

```
node --version
```

If you see a version number (v18 or higher), you're set. If you see an error, install Node first.

## Running it

1. Copy this whole `benchmark-standalone` folder onto the machine you're testing (USB drive, AirDrop,
   email it to yourself, cloud drive — any way you'd normally move a folder).
2. Open a terminal and navigate into the folder. Example on Mac:
   ```
   cd ~/Desktop/benchmark-standalone
   ```
   Example on Windows (PowerShell):
   ```
   cd $HOME\Desktop\benchmark-standalone
   ```
3. Install the one dependency:
   ```
   npm install
   ```
4. Run it:
   ```
   node benchmark.mjs
   ```

That's it — it prints download time and decode time for a few real, currently-active radar stations,
then a summary at the end.

## What to send back

Just copy-paste the full terminal output — every number in it is useful for comparing this machine
against the Fly.io worker.

## Testing a specific station

By default it checks KFFC, KBMX, and KMPX. To test different ones:

```
node benchmark.mjs KTLX KOUN
```
