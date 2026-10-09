import sys
import os
import time
import glob
import subprocess

BIN_PATH = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/ESP32_GENERIC_C3-20260824-v1.29.0.bin"
MAIN_PATH = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/main.py"
UVX_PATH = "/Users/timonterzic/.local/bin/uvx"

def find_esp_port():
    ports = glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/cu.usbserial*")
    return ports[0] if ports else None

def run_cmd(cmd):
    print(f">> {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        err = res.stderr.strip() or res.stdout.strip()
        print("ERROR:", err)
        return False, err
    print(res.stdout.strip())
    return True, res.stdout

def flash_board(port):
    print(f"\n==========================================")
    print(f"Detektirana plocica na portu: {port}")
    print(f"==========================================")
    
    # Koristimo samo JEDAN esptool poziv s --erase-all tako da nema diskonekcije porta izmedu brisanja i pisanja
    print("\n[1/2] Kompletno brisanje i snimanje MicroPython firmwarea u jednom prolazu...")
    ok, out = run_cmd([
        UVX_PATH, "esptool",
        "--port", port,
        "--chip", "esp32c3",
        "write-flash",
        "--erase-all",
        "-z", "0x0", BIN_PATH
    ])
    if not ok:
        print("Greska pri snimanju firmwarea. Pokusajte ponovno uci u bootloader.")
        return False

    print("\n[2/2] Cekam inicijalizaciju MicroPython USB sucelja...")
    # Cekamo do 6 sekundi da se MicroPython pojavi na USB-u
    mpy_port = None
    for _ in range(12):
        time.sleep(0.5)
        p = find_esp_port()
        if p:
            mpy_port = p
            break
            
    if not mpy_port:
        print("Upozorenje: Port se nije odmah pojavio nakon reseta.")
        mpy_port = port

    print(f"Kopiranje main.py na {mpy_port}...")
    copied = False
    for attempt in range(5):
        time.sleep(1)
        ok, _ = run_cmd([UVX_PATH, "mpremote", "connect", mpy_port, "cp", MAIN_PATH, ":main.py"])
        if ok:
            copied = True
            break
        print(f"Pokusaj {attempt + 1}/5 spajanja na mpremote...")

    if copied:
        # Soft reset bez prekida USB konekcije (reboot samo pythona koji odmah pokrece main.py)
        print("Pokretanje main.py...")
        run_cmd([UVX_PATH, "mpremote", "connect", mpy_port, "soft-reset"])
        print("\n==========================================")
        print("PLOCICA JE USPJESNO FLEŠANA I POKRENUTA!")
        print("- Plava LED na plocici mora odmah treperiti.")
        print("- Traka (WS2814) izvodi dvostruki bijeli bljesak i chaser.")
        print("==========================================\n")
        return True
    else:
        print("Nije uspjelo automatsko kopiranje main.py.")
        return False

def main():
    print("==================================================")
    print("LEDicated Auto-Flasher spreman.")
    print("Ukopcajte plocicu u USB (ako treba: drzite BOOT, stisnite RST).")
    print("==================================================\n")
    
    last_flashed_time = 0
    while True:
        port = find_esp_port()
        now = time.time()
        # Ako je port prisutan i proslo je barem 10 sekundi od zadnjeg flesanja
        if port and (now - last_flashed_time > 10):
            success = flash_board(port)
            if success:
                last_flashed_time = time.time()
                print("\nSpremno! Mozete odspojiti ovu i ukopcati sljedecu plocicu...\n")
            else:
                last_flashed_time = time.time()
        time.sleep(0.5)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nPrekinuto.")
