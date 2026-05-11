#!/usr/bin/env python3
"""Gera os ícones do app CicloEstudos em PNG (192x192 e 512x512)"""
import struct, zlib, math

def png_chunk(name, data):
    chunk = name + data
    crc = zlib.crc32(chunk) & 0xffffffff
    return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)

def make_png(size):
    # Fundo gradiente azul escuro + livro + relógio
    img = []
    for y in range(size):
        row = []
        for x in range(size):
            # Fundo circular com gradiente
            cx, cy = size/2, size/2
            dist   = math.sqrt((x-cx)**2 + (y-cy)**2)
            r_out  = size * 0.48
            r_in   = size * 0.42

            # Arredondamento
            in_circle = dist <= r_out

            # Gradiente de fundo
            t = y / size
            if in_circle:
                bg_r = int(26  + (35 - 26)  * t)
                bg_g = int(34  + (52 - 34)  * t)
                bg_b = int(52  + (68 - 52)  * t)
            else:
                bg_r, bg_g, bg_b = 15, 22, 35

            # Livro estilizado (retângulo com páginas)
            book_x = size * 0.25
            book_y = size * 0.30
            book_w = size * 0.50
            book_h = size * 0.35
            bx = x - book_x
            by = y - book_y
            in_book = (0 <= bx <= book_w) and (0 <= by <= book_h)

            # Linha do meio do livro
            mid = book_x + book_w / 2
            in_spine = in_book and abs(x - mid) <= size * 0.025

            # Linhas de texto (3 linhas)
            margin = size * 0.06
            line_h = book_h / 5
            lines_x0 = book_x + margin
            lines_x1_l = mid - size * 0.04
            lines_x1_r = book_x + book_w - margin
            in_line = False
            for li in range(1, 4):
                ly = book_y + line_h * li
                if abs(y - ly) <= size * 0.018:
                    if x < mid and x >= lines_x0:
                        in_line = True
                    if x > mid and x <= lines_x1_r:
                        in_line = True

            # Borda do livro
            brd = size * 0.018
            in_book_border = (
                (abs(bx) <= brd or abs(bx - book_w) <= brd or
                 abs(by) <= brd or abs(by - book_h) <= brd)
                and 0 <= bx <= book_w and 0 <= by <= book_h
            )

            # Seta circular (timer) acima/abaixo do livro
            arc_cx = size * 0.73
            arc_cy = size * 0.68
            arc_r  = size * 0.16
            arc_w  = size * 0.04
            ad = math.sqrt((x - arc_cx)**2 + (y - arc_cy)**2)
            angle = math.atan2(y - arc_cy, x - arc_cx)
            in_arc = (arc_r - arc_w/2 <= ad <= arc_r + arc_w/2) and (-math.pi*0.1 <= angle <= math.pi*1.5)

            # Ponteiro do relógio
            ptr_angle = -math.pi / 4
            ptr_len   = arc_r * 0.65
            ptr_w     = size * 0.022
            # Ponto no eixo do ponteiro
            px = arc_cx + math.cos(ptr_angle) * ptr_len * 0.5
            py = arc_cy + math.sin(ptr_angle) * ptr_len * 0.5
            dx = math.cos(ptr_angle + math.pi/2)
            dy = math.sin(ptr_angle + math.pi/2)
            vx = x - px; vy = y - py
            along  = vx * math.cos(ptr_angle) + vy * math.sin(ptr_angle)
            perp   = abs(vx * dx + vy * dy)
            in_ptr = (abs(along) <= ptr_len * 0.5) and (perp <= ptr_w / 2)

            # Centro do relógio
            in_center = math.sqrt((x - arc_cx)**2 + (y - arc_cy)**2) <= size * 0.03

            # Cor final
            accent = (74, 138, 244)
            white  = (220, 230, 245)
            dark   = (20, 30, 50)

            if in_spine:
                r, g, b, a = accent[0], accent[1], accent[2], 255
            elif in_book_border:
                r, g, b, a = accent[0]-20, accent[1]-30, accent[2], 255
            elif in_book:
                r, g, b, a = int(dark[0]*1.5), int(dark[1]*1.5), int(dark[2]*1.5), 255
                if in_line:
                    r, g, b = white
            elif in_center:
                r, g, b, a = accent[0]+30, accent[1]+20, 255, 255
            elif in_arc or in_ptr:
                r, g, b, a = accent[0]+20, accent[1]+30, 255, 255
            elif in_circle:
                r, g, b, a = bg_r, bg_g, bg_b, 255
            else:
                r, g, b, a = bg_r, bg_g, bg_b, 0

            row.extend([r, g, b, a])
        img.append(row)

    # Encode PNG
    raw = b''
    for row in img:
        raw += b'\x00' + bytes(row)
    compressed = zlib.compress(raw, 9)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    # RGBA = color type 6
    ihdr_data = struct.pack('>II', size, size) + bytes([8, 6, 0, 0, 0])
    ihdr = png_chunk(b'IHDR', ihdr_data)
    idat = png_chunk(b'IDAT', compressed)
    iend = png_chunk(b'IEND', b'')

    return sig + ihdr + idat + iend

import os
os.makedirs('icons', exist_ok=True)
for sz in [192, 512]:
    with open(f'icons/icon-{sz}.png', 'wb') as f:
        f.write(make_png(sz))
    print(f'Gerado: icons/icon-{sz}.png ({sz}x{sz})')
print('Ícones criados com sucesso!')
