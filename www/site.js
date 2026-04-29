/* ═══════════════════════════════════════════════════════════════════════
   Forma — Showcase Landing Page Scripts
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── 1. Hero Canvas — lightweight Game of Life ───────────────────── */
    const canvas = document.getElementById('hero-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        const CELL = 6;
        let cols, rows, grid, next;
        let animId = null;
        let lastTick = 0;
        const TICK_MS = 100;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            ctx.scale(dpr, dpr);
            canvas.style.width = window.innerWidth + 'px';
            canvas.style.height = window.innerHeight + 'px';
            const newCols = Math.ceil(window.innerWidth / CELL);
            const newRows = Math.ceil(window.innerHeight / CELL);
            if (newCols !== cols || newRows !== rows) {
                cols = newCols;
                rows = newRows;
                initGrid();
            }
        }

        function initGrid() {
            grid = new Uint8Array(cols * rows);
            next = new Uint8Array(cols * rows);
            for (let i = 0; i < grid.length; i++) {
                grid[i] = Math.random() < 0.15 ? 1 : 0;
            }
        }

        function idx(x, y) { return y * cols + x; }

        function step() {
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    let n = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = (x + dx + cols) % cols;
                            const ny = (y + dy + rows) % rows;
                            n += grid[idx(nx, ny)];
                        }
                    }
                    const i = idx(x, y);
                    if (grid[i]) {
                        next[i] = (n === 2 || n === 3) ? 1 : 0;
                    } else {
                        next[i] = (n === 3) ? 1 : 0;
                    }
                }
            }
            [grid, next] = [next, grid];
        }

        function draw() {
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    if (grid[idx(x, y)]) {
                        const alpha = 0.3 + Math.random() * 0.35;
                        ctx.fillStyle = `rgba(78, 232, 255, ${alpha})`;
                        ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
                    }
                }
            }
        }

        function loop(ts) {
            animId = requestAnimationFrame(loop);
            if (ts - lastTick >= TICK_MS) {
                step();
                draw();
                lastTick = ts;
            }
        }

        // Pause when not visible
        const heroObserver = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                if (!animId) animId = requestAnimationFrame(loop);
            } else {
                if (animId) { cancelAnimationFrame(animId); animId = null; }
            }
        }, { threshold: 0.1 });

        resize();
        heroObserver.observe(canvas);
        window.addEventListener('resize', () => {
            resize();
            draw();
        });

        // Reduced motion: just show static frame
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            draw();
        }
    }

    /* ── 2. Scroll Reveal (IntersectionObserver) ────────────────────── */
    const reveals = document.querySelectorAll('.reveal');
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(el => revealObserver.observe(el));

    // Hide scroll hint after first scroll
    let scrollHintHidden = false;
    const scrollHint = document.getElementById('scroll-hint');
    window.addEventListener('scroll', () => {
        if (!scrollHintHidden && window.scrollY > 80 && scrollHint) {
            scrollHint.style.opacity = '0';
            scrollHint.style.transition = 'opacity 0.5s';
            scrollHintHidden = true;
        }
    }, { passive: true });

    /* ── 3. Theme Gallery ───────────────────────────────────────────── */
    const themeData = {
        lab: {
            name: 'Lab',
            tagline: 'Cyan diagnostics on midnight silicon',
            desc: 'A clinical, high-contrast theme inspired by laboratory displays and diagnostic interfaces. Sharp corners and glowing cyan accents cut through deep navy darkness.',
            accent: '#4ee8ff',
            palette: ['#071118', '#4ee8ff', '#eef7ff', 'rgba(78,232,255,0.14)']
        },
        ember: {
            name: 'Ember',
            tagline: 'Molten amber flowing through volcanic glass',
            desc: 'Warm, organic, and alive. Rounded surfaces glow with ember-orange light, like cells burning in slow motion against obsidian.',
            accent: '#ff9f43',
            palette: ['#140805', '#ff9f43', '#fff1e5', 'rgba(255,144,61,0.16)']
        },
        bio: {
            name: 'Bio',
            tagline: 'Phosphorescent life beneath deep canopy',
            desc: 'Lush green bioluminescence on a forest-floor darkness. Soft, rounded shapes pulse with organic energy.',
            accent: '#66ffb3',
            palette: ['#07140f', '#66ffb3', '#ecfff5', 'rgba(92,255,159,0.16)']
        },
        mono: {
            name: 'Mono',
            tagline: 'Pure signal, zero noise',
            desc: 'Stark grayscale minimalism. Dashed borders, hard corners, and zero color — just structure and light.',
            accent: '#f3f3f3',
            palette: ['#0d0d0d', '#f3f3f3', '#f5f5f5', 'rgba(255,255,255,0.12)']
        }
    };

    const tabs = document.querySelectorAll('.theme-tab');
    const previews = document.querySelectorAll('.theme-preview-inner');
    const themeName = document.getElementById('theme-name');
    const themeTagline = document.getElementById('theme-tagline');
    const themeDesc = document.getElementById('theme-desc');
    const themePalette = document.getElementById('theme-palette');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const key = tab.dataset.theme;
            const data = themeData[key];
            if (!data) return;

            // Update tabs
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update preview
            previews.forEach(p => {
                p.classList.toggle('hidden', p.dataset.theme !== key);
            });

            // Update info
            themeName.textContent = data.name;
            themeName.style.color = data.accent;
            themeTagline.textContent = data.tagline;
            themeDesc.textContent = data.desc;

            // Update palette swatches
            const swatches = themePalette.querySelectorAll('.theme-swatch');
            data.palette.forEach((c, i) => {
                if (swatches[i]) swatches[i].style.background = c;
            });
        });
    });

    /* ── 4. Smooth anchor scroll ────────────────────────────────────── */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const target = document.querySelector(a.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

})();
