(function () {
    const STYLE_ID = 'supersteaks-more-menu-style';

    function getPanel(menu) {
        return menu ? menu.querySelector('div') : null;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            details.more-nav-menu {
                position: static;
                display: inline-flex;
                align-items: center;
                vertical-align: middle;
            }

            details.more-nav-menu > summary.nav-link {
                margin: 0 !important;
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                font: inherit !important;
                font-size: inherit !important;
                line-height: inherit !important;
            }

            details.more-nav-menu > div {
                position: fixed !important;
                left: 0 !important;
                right: 0 !important;
                top: var(--more-menu-top, 64px) !important;
                width: 100vw !important;
                max-width: 100vw !important;
                border-radius: 0 !important;
                border-left: 0 !important;
                border-right: 0 !important;
                padding: 0.75rem 1rem !important;
                display: flex !important;
                flex-wrap: wrap;
                justify-content: center;
                align-items: center;
                gap: 0.5rem;
                box-shadow: 0 12px 24px rgba(15, 23, 42, 0.16) !important;
                transform: translateY(-8px);
                opacity: 0;
                pointer-events: none;
                transition: opacity 150ms ease, transform 150ms ease;
                z-index: 60 !important;
            }

            details.more-nav-menu[open] > div {
                pointer-events: auto;
            }

            details.more-nav-menu > div.more-menu-visible {
                transform: translateY(0);
                opacity: 1;
            }

            details.more-nav-menu > div a {
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                padding: 0.45rem 0.85rem !important;
                border-radius: 9999px;
                white-space: nowrap;
            }

            @media (max-width: 639px) {
                details.more-nav-menu > div {
                    justify-content: flex-start;
                }
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

        const closeMenu = (menu) => {
            const summary = menu.querySelector('summary');
            const panel = getPanel(menu);

            if (summary) {
                summary.setAttribute('aria-expanded', 'false');
            }

            if (panel) {
                panel.classList.remove('more-menu-visible');
            }

            menu.removeAttribute('open');
        };

        const closeAll = () => {
            menus.forEach((menu) => closeMenu(menu));
        };

        const openMenu = (menu) => {
            closeAll();

            const summary = menu.querySelector('summary');
            const panel = getPanel(menu);
            const triggerRect = summary ? summary.getBoundingClientRect() : null;

            menu.setAttribute('open', 'open');

            if (summary) {
                summary.setAttribute('aria-expanded', 'true');
            }

            if (panel) {
                const topOffset = triggerRect ? Math.round(triggerRect.bottom + 8) : 64;
                panel.style.setProperty('--more-menu-top', `${topOffset}px`);
                requestAnimationFrame(() => {
                    panel.classList.add('more-menu-visible');
                });
            }
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
                } else {
                    openMenu(menu);
                }
            });

            const panel = getPanel(menu);
            const panelLinks = panel ? panel.querySelectorAll('a') : [];
            panelLinks.forEach((link) => {
                link.addEventListener('click', () => {
                    closeAll();
                });
            });
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

        window.addEventListener('scroll', () => {
            closeAll();
        }, { passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMoreMenus, { once: true });
    } else {
        initMoreMenus();
    }
})();
