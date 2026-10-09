import sys
import os
import time
import glob
import subprocess

C3_BIN = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/ESP32_GENERIC_C3-20260824-v1.29.0.bin"
ESP32_BIN = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/ESP32_GENERIC-20240602-v1.23.0.bin"
MAIN_PATH = "/Users/timonterzic/Documents/Projekti/LEDicated/firmware/main.py"
UVX_PATH = "/Users/timonterzic/.local/bin/uvx"

def find_serial_ports():
    return glob.glob("/dev/cu.usb*") + glob.glob("/dev/cu.wch*") + glob.glob("/dev/cu.SLAB*")

def run_cmd(cmd):
    print(f">> {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    out = res.stdout.strip()
    err = res.stderr.strip()
    if res.returncode != 0:
        print("INFO/ERR:", err or out)
        return False, out + "\n" + err
    print(out)
    return True, out

def flash_device(port):
    print(f"\n==========================================")
    print(f"Detektiran uređaj na: {port}")
    print(f"Čekam 2 sekunde da se USB driver stabilizira...")
    print(f"==========================================")
    time.sleep(2)
    
    # 1. Identifikacija čipa uz do 3 pokušaja
    print("\n[1/3] Identifikacija čipa...")
    out = ""
    ok = False
    for attempt in range(3):
        ok, out = run_cmd([UVX_PATH, "esptool", "--port", port, "--baud", "115200", "chip-id"])
        if ok:
            break
        print(f"Pokušaj {attempt + 1}/3... Ako ne krene, držite tipku na pločici.")
        time.sleep(1.5)

    if not ok:
        print("Nije uspjela komunikacija. Provjerite je li kabel čvrsto spojen.")
        return False

    out_lower = out.lower()
    if "esp32-c3" in out_lower:
        chip_type = "esp32c3"
        firmware_path = C3_BIN
        flash_offset = "0x0"
        print("-> Prepoznat ESP32-C3 čip")
    elif "esp32" in out_lower:
        chip_type = "esp32"
        firmware_path = ESP32_BIN
        flash_offset = "0x1000"
        print("-> Prepoznat klasični ESP32 čip")
    else:
        print("Nepoznat čip:", out)
        return False

    # 2. Flash u jednom potezu sa --erase-all
    print(f"\n[2/3] Brisanje i programiranje ({chip_type} na {flash_offset})...")
    ok, _ = run_cmd([
        UVX_PATH, "esptool",
        "--port", port,
        "--chip", chip_type,
        "--baud", "460800",
        "write-flash",
        "--erase-all",
        "-z", flash_offset, firmware_path
    ])
    if not ok:
        print("Flash nije uspio.")
        return False

    # 3. Kopiranje programa
    print("\n[3/3] Čekam podizanje MicroPython sučelja...")
    time.sleep(3)
    
    copied = False
    for attempt in range(5):
        time.sleep(1)
        ok, _ = run_cmd([UVX_PATH, "mpremote", "connect", port, "cp", MAIN_PATH, ":main.py"])
        if ok:
            copied = True
            break
        print(f"Pokušaj {attempt + 1}/5 kopiranja main.py...")

    if copied:
        print("\nPokretanje programa...")
        run_cmd([UVX_PATH, "mpremote", "connect", port, "soft-reset"])
        print("\n==========================================")
        print("PLOČICA JE USPJEŠNO FLEŠANA I AKTIVNA!")
        print("- Program radi")
        print("- WS2814 traka izvodi bijeli bljesak i chaser u boji")
        print("==========================================\n")
        return True
    else:
        print("Program nije automatski prenesen.")
        return False

def main():
    print("==================================================")
    print("LEDicated Auto-Flasher spreman.")
    print("Ukopčajte pločicu USB kabelom...")
    print("==================================================\n")
    
    last_flashed_time = 0
    while True:
        ports = find_serial_ports()
        now = time.time()
        if ports and (now - last_flashed_time > 10):
            port = ports[0]
            success = flash_device(port)
            last_flashed_time = time.time()
            if success:
                print("\nSpremno za sljedeću pločicu...\n")
        time.sleep(0.5)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nPrekinuto.")
