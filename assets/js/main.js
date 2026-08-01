// ---------------------------------------------------------------------------
// Shared front-end behaviour for the static landing site
// ---------------------------------------------------------------------------

function toggleTheme() {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}

// Password show/hide toggle (works on any input wired up with a
// .password-toggle button + data-target pointing at the input's id)
document.addEventListener('click', function (e) {
    const btn = e.target.closest('.password-toggle');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const icon = btn.querySelector('i');
    const showing = input.type === 'text';

    input.type = showing ? 'password' : 'text';
    icon.classList.toggle('fa-eye', showing);
    icon.classList.toggle('fa-eye-slash', !showing);
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});

// FAQ accordion (safe to include on every page; only does anything if
// .faq-toggle elements exist, e.g. on faq.html)
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.faq-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const panel = btn.nextElementSibling;
            const icon = btn.querySelector('i');
            const isOpen = !panel.classList.contains('hidden');

            document.querySelectorAll('.faq-panel').forEach(function (p) { p.classList.add('hidden'); });
            document.querySelectorAll('.faq-toggle i').forEach(function (i) { i.style.transform = ''; });

            if (!isOpen) {
                panel.classList.remove('hidden');
                icon.style.transform = 'rotate(180deg)';
            }
        });
    });
});

// ---------------------------------------------------------------------------
// Mobile sidebar drawer (app pages only — a no-op if these elements aren't
// on the page, so it's safe to include everywhere via main.js).
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    const openBtn = document.getElementById('sidebarToggle');
    const closeBtn = document.getElementById('sidebarClose');
    if (!sidebar || !backdrop || !openBtn) return;

    function openSidebar() {
        sidebar.classList.remove('-translate-x-full');
        backdrop.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        openBtn.setAttribute('aria-expanded', 'true');
    }

    function closeSidebar() {
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
        document.body.style.overflow = '';
        openBtn.setAttribute('aria-expanded', 'false');
    }

    openBtn.addEventListener('click', openSidebar);
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
    backdrop.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSidebar();
    });
    // Close automatically if the viewport is resized up to desktop width.
    window.addEventListener('resize', function () {
        if (window.innerWidth >= 1024) closeSidebar();
    });
});
