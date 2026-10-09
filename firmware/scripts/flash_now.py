import sys
import os
import time
import glob
import subprocess

ESP32_BIN = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/ESP32_GENERIC-20240602-v1.23.0.bin"
C3_BIN = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/ESP32_GENERIC_C3-20260824-v1.29.0.bin"
MAIN_PATH = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/main.py"
UVX_PATH = "/Users/timonterzic/.local/bin/uvx"

def get_ports():
    return glob.glob("/dev/cu.usb*") + glob.glob("/dev/cu.wch*") + glob.glob("/dev/cu.SLAB*")

print("==================================================")
print("[KORAK 1] ISKOPČAJTE USB KABEL IZ MACA...")
print("==================================================")

# Čekaj da korisnik iskopča kabel (port mora nestati)
while get_ports():
    time.sleep(0.2)

print("\n==================================================")
print("[KORAK 2] ODLIČNO! SADA UKOPČAJTE KABEL NATRAG...")
print("==================================================")

# Čekaj da korisnik ponovno ukopča kabel
new_port = None
while not new_port:
    time.sleep(0.3)
    ports = get_ports()
    if ports:
        new_port = ports[0]

print(f"\n[KORAK 3] Detektiran svježi port: {new_port}")
print("Čekam 1.5 sekundi za stabilizaciju macOS drivera...")
time.sleep(1.5)

# Identifikacija
print("\n[1/3] Identifikacija čipa...")
res = subprocess.run([UVX_PATH, "esptool", "--port", new_port, "--baud", "115200", "chip-id"], capture_output=True, text=True)
out = res.stdout + res.stderr
print(out.strip())

if "esp32-c3" in out.lower():
    chip = "esp32c3"
    bin_file = C3_BIN
    offset = "0x0"
else:
    chip = "esp32"
    bin_file = ESP32_BIN
    offset = "0x1000"

print(f"\n[2/3] Snimanje MicroPython firmwarea ({chip} na {offset})...")
res = subprocess.run([
    UVX_PATH, "esptool",
    "--port", new_port,
    "--chip", chip,
    "--baud", "460800",
    "write-flash",
    "--erase-all",
    "-z", offset, bin_file
], capture_output=True, text=True)

if res.returncode != 0:
    print("Greška pri snimanju:", res.stderr or res.stdout)
    sys.exit(1)

print(res.stdout.strip())

# Kopiranje main.py
print("\n[3/3] Čekam podizanje MicroPython sučelja...")
time.sleep(3)

print("Kopiram testni program main.py...")
res = subprocess.run([UVX_PATH, "mpremote", "connect", new_port, "cp", MAIN_PATH, ":main.py"], capture_output=True, text=True)
print(res.stdout.strip())

print("Pokrećem program preko soft-reseta...")
subprocess.run([UVX_PATH, "mpremote", "connect", new_port, "soft-reset"], capture_output=True, text=True)

print("\n==================================================")
print("USPJEŠNO ZAVRŠENO!")
print("Ugrađena LED dioda (GPIO 22) na Lolin32 Lite ploči mora početi pulsirati!")
print("==================================================")
