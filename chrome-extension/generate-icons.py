import os
from PIL import Image, ImageDraw

def create_icon(size):
    # Create an RGBA image with transparent background
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Outer rounded rectangle (YouTube Red #FF0033 / #FF0000)
    padding = max(1, int(size * 0.08))
    radius = int(size * 0.22)
    
    # Draw background red rounded rectangle
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=radius,
        fill=(255, 0, 51, 255)
    )
    
    # Draw modern download arrow + tray inside
    # Center coordinates
    cx = size / 2.0
    cy = size / 2.0
    
    # Arrow coordinates
    arrow_color = (255, 255, 255, 255)
    
    # Arrow shaft width and height
    sw = max(1.5, size * 0.12)
    top_y = size * 0.26
    mid_y = size * 0.52
    arrow_tip_y = size * 0.64
    arrow_wing_w = size * 0.24
    
    # Shaft
    draw.rectangle([cx - sw/2, top_y, cx + sw/2, mid_y], fill=arrow_color)
    
    # Arrow head (triangle)
    draw.polygon([
        (cx, arrow_tip_y),
        (cx - arrow_wing_w, mid_y),
        (cx + arrow_wing_w, mid_y)
    ], fill=arrow_color)
    
    # Bottom tray line / bar
    tray_h = max(1.5, size * 0.08)
    tray_y = size * 0.74
    tray_w = size * 0.56
    draw.rounded_rectangle([cx - tray_w/2, tray_y, cx + tray_w/2, tray_y + tray_h], radius=int(tray_h/2), fill=arrow_color)
    
    return img

def main():
    os.makedirs("icons", exist_ok=True)
    for size in [16, 48, 128]:
        icon = create_icon(size)
        icon.save(f"icons/icon-{size}.png", "PNG")
        print(f"Generated icons/icon-{size}.png ({size}x{size})")

if __name__ == "__main__":
    main()
