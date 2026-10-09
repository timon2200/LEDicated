import machine
import neopixel
import time

print("[LEDicated] Lolin32 Lite / ESP32 univerzalni test...")

# Statusna LED-ica na Lolin32 Lite je na GPIO 22 (active LOW: 0 = UPALJENA, 1 = UGASENA)
# Na ostalim plocicama je na GPIO 2 ili GPIO 8
status_pins = [22, 2, 8]
status_leds = []
for p in status_pins:
    try:
        status_leds.append(machine.Pin(p, machine.Pin.OUT))
    except Exception:
        pass

def set_leds(is_on):
    for led in status_leds:
        try:
            # GPIO 22 i GPIO 8 su active LOW (0 pali), GPIO 2 je active HIGH (1 pali)
            # Postavljamo oba stanja tako da sigurno svijetli
            led.value(0 if is_on else 1)
        except Exception:
            pass

# Odmah upali onboard LED da korisnik vidi da je plocica ziva!
set_leds(True)

# WS2814 24V 60LED/m = 10 IC po metru -> 50 IC-ova za 5m kolut
NUM_PIXELS = 50

# Svi izlazni pinovi na Lolin32 Lite:
# Lijeva strana: 13, 15, 2, 4, 16, 17, 5, 18, 23, 19
# Desna strana: 12, 14, 27, 26, 25, 33, 32
CANDIDATE_PINS = [2, 4, 16, 17, 5, 18, 23, 19, 13, 15, 12, 14, 27, 26, 25, 33, 32]
drivers = []

for p in CANDIDATE_PINS:
    try:
        pin_obj = machine.Pin(p, machine.Pin.OUT)
        drv = neopixel.NeoPixel(pin_obj, NUM_PIXELS, bpp=4)
        drivers.append((p, drv))
    except Exception as e:
        pass

print("Aktivni driveri na pinovima:", [p for p, _ in drivers])

def fill_all(color):
    for _, drv in drivers:
        for i in range(NUM_PIXELS):
            drv[i] = color
        drv.write()

def write_all(color_list):
    for _, drv in drivers:
        for i in range(NUM_PIXELS):
            drv[i] = color_list[i]
        drv.write()

# Glavna petlja
while True:
    # 1. Jasno blinkanje onboard LED diode (brzi dvostruki bljesak)
    for _ in range(2):
        set_leds(True)
        fill_all((255, 255, 255, 255))
        time.sleep_ms(100)

        set_leds(False)
        fill_all((0, 0, 0, 0))
        time.sleep_ms(100)

    time.sleep_ms(250)

    # 2. Chaser kroz svih 50 piksela u boji
    colors = [
        (255, 0, 0, 0),     # Crvena
        (0, 255, 0, 0),     # Zelena
        (0, 0, 255, 0),     # Plava
        (0, 0, 0, 255),     # Toplo bijela
    ]

    for c in colors:
        for i in range(NUM_PIXELS):
            buf = [(0, 0, 0, 0)] * NUM_PIXELS
            buf[i] = c
            if i > 0:
                buf[i - 1] = tuple(v // 3 for v in c)
            write_all(buf)

            # LED treperi u ritmu chasera
            set_leds(i % 5 == 0)
            time.sleep_ms(25)

    fill_all((0, 0, 0, 0))
    set_leds(False)
    time.sleep_ms(300)
