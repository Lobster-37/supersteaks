(function () {
    const STYLE_ID = 'supersteaks-more-menu-style';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .more-menu-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.35);
                opacity: 0;
                pointer-events: none;
                transition: opacity 140ms ease;
                z-index: 40;
            }

            .more-menu-backdrop.is-visible {
                opacity: 1;
                pointer-events: auto;
            }

            details.more-nav-menu > div {
                transform: translate(-50%, -6px) scale(0.98);
                opacity: 0;
                pointer-events: none;
                transition: opacity 140ms ease, transform 140ms ease;
            }

            details.more-nav-menu[open] > div {
                pointer-events: auto;
            }

            details.more-nav-menu > div.more-menu-visible {
                transform: translate(-50%, 0) scale(1);
                opacity: 1;
            }
        `;

        document.head.appendChild(style);
    }

    function initMoreMenus() {
        const menus = Array.from(document.querySelectorAll('details.more-nav-menu'));
        if (!menus.length) {
            return;
        }

        injectStyles();

        const backdrop = document.createElement('button');
        backdrop.type = 'button';
        backdrop.className = 'more-menu-backdrop';
        backdrop.setAttribute('aria-label', 'Close menu');
        document.body.appendChild(backdrop);

        const closeMenu = (menu) => {
            const summary = menu.querySelector('summary');
            const panel = menu.querySelector(':scope > div');

            if (summary) {
                summary.setAttribute('aria-expanded', 'false');
            }

            if (panel) {
                panel.classList.remove('more-menu-visible');
            }

            window.setTimeout(() => {
                menu.removeAttribute('open');
            }, 140);
        };

        const closeAll = () => {
            menus.forEach((menu) => closeMenu(menu));
            backdrop.classList.remove('is-visible');
        };

        const openMenu = (menu) => {
            closeAll();

            const summary = menu.querySelector('summary');
            const panel = menu.querySelector(':scope > div');

            menu.setAttribute('open', 'open');

            if (summary) {
                summary.setAttribute('aria-expanded', 'true');
            }

            if (panel) {
                requestAnimationFrame(() => {
                    panel.classList.add('more-menu-visible');
                });
            }

            backdrop.classList.add('is-visible');
        };

        menus.forEach((menu) => {
            const summary = menu.querySelector('summary');
            if (!summary) {
                return;
            }

            summary.setAttribute('aria-haspopup', 'menu');
            summary.setAttribute('aria-expanded', 'false');

            summary.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const isOpen = menu.hasAttribute('open');
                if (isOpen) {
                    closeMenu(menu);
                    backdrop.classList.remove('is-visible');
                } else {
                    openMenu(menu);
                }
            });
        });

        backdrop.addEventListener('click', () => {
            closeAll();
        });

        document.addEventListener('click', (event) => {
            const clickedInMenu = menus.some((menu) => menu.contains(event.target));
            if (!clickedInMenu) {
                closeAll();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeAll();
            }
        });

        window.addEventListener('resize', () => {
            closeAll();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMoreMenus, { once: true });
    } else {
        initMoreMenus();
    }
})();
