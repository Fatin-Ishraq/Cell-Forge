from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "icons"


def render(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")

    pad = int(size * 0.11)
    radius = int(size * 0.19)
    border = max(2, size // 36)

    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        fill=(10, 28, 42, 255),
        outline=(58, 237, 181, 235),
        width=border,
    )

    grid = 3
    cell_size = int(size * 0.125)
    gap = int(size * 0.028)
    start = (size - (grid * cell_size + (grid - 1) * gap)) // 2
    cell_r = max(3, int(size * 0.023))

    off = (24, 66, 90, 255)
    mid = (36, 124, 118, 255)
    on = (59, 245, 179, 255)
    pattern = [
        [off, mid, off],
        [mid, on, mid],
        [off, mid, off],
    ]

    for y in range(grid):
        for x in range(grid):
            x0 = start + x * (cell_size + gap)
            y0 = start + y * (cell_size + gap)
            draw.rounded_rectangle(
                [x0, y0, x0 + cell_size, y0 + cell_size],
                radius=cell_r,
                fill=pattern[y][x],
            )

    points = []
    p0 = int(size * 0.25)
    p1 = int(size * 0.77)
    width = max(3, int(size * 0.04))
    for i in range(100):
        t = i / 99.0
        x = int(size * (0.24 + 0.53 * t))
        if t < 0.5:
            y = int(size * (0.68 - 0.07 * (t / 0.5)))
        else:
            y = int(size * (0.61 + 0.06 * ((t - 0.5) / 0.5)))
        points.append((x, y))

    draw.line(points, fill=(52, 222, 255, 245), width=width, joint="curve")
    draw.line(points, fill=(74, 255, 193, 210), width=max(1, width // 2), joint="curve")

    return image


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sizes = [16, 24, 32, 48, 64, 128, 256]
    rendered = {size: render(size) for size in sizes}

    for size, image in rendered.items():
        image.save(OUT_DIR / f"forma-{size}.png")

    rendered[256].save(
        OUT_DIR / "forma-app.ico",
        format="ICO",
        sizes=[(size, size) for size in sizes],
    )

    print(f"Generated icon assets in {OUT_DIR}")


if __name__ == "__main__":
    main()
