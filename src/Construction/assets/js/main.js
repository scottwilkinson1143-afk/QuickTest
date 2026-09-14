
/* Global Functions  */
// Toggle Sidenav
const iconNavbarSidenav = document.getElementById('iconNavbarSidenav');
const iconSidenav = document.getElementById('iconSidenav');
const sidenav = document.getElementById('sidenav-main');
let body = document.getElementsByTagName('body')[0];
let className = 'g-sidenav-pinned';

/* Functions */

//###################################################
//#####                                        ######
//#####       ARRAY FUNCTIONS                  ######
//#####                                        ######
//###################################################

/* Remove duplicates in an array */
const removeDuplicates = (value, index, array) => array.indexOf(value) === index;

/* Add elements to an array and removes duplicates */
function addElement(arr, element) {
	if (arr.includes(element)) {
	  arr.splice(arr.indexOf(element),1);
	}
	arr.unshift(element);
}

/* Gravatar insert function */
(function ($) {
	$.gravatar = function (emailAddress, overrides) {
		const options = $.extend({
			//Some defaults are not hardcoded as gravatar could change them on their end.
			size: '', //integer size: between 1 and 512, default 80 (in pixels)
			rating: '', //rating: g (default), pg, r, x
			image: '' , //url to define a default image (can also be one of: identicon, monsterid, wavatar)
			secure: true, //secure
			classes: 'img-xs rounded-circle gravatarImg' //support css on img element
		}, overrides);

		const baseUrl = options.secure ? 'https://secure.gravatar.com/avatar/' : 'http://www.gravatar.com/avatar/';
		const query = `${options.size ? `s=${options.size}&` : ''}${options.rating ? `r=${options.rating}&` : ''}${options.image ? `d=${encodeURIComponent(options.image)}` : ''}`;
		const classAttr = options.classes ? ` class="${options.classes}"` : '';

		return $(`<img src="${baseUrl}${hex_md5(emailAddress)}.jpg?${query}"${classAttr} />`).bind('error', function () {
				$(this).remove();
			});
	};
})(jQuery);

// when input is focused add focused class for style
function focused(el) {
  if (el.parentElement.classList.contains('input-group')) {
    el.parentElement.classList.add('focused');
  }
}

// when input is focused remove focused class for style
function defocused(el) {
  if (el.parentElement.classList.contains('input-group')) {
    el.parentElement.classList.remove('focused');
  }
}

// helper for adding on all elements multiple attributes
function setAttributes(el, options) {
  Object.keys(options).forEach(function (attr) {
    el.setAttribute(attr, options[attr]);
  })
}



//Set active tab
function setActiveTab(clickedTab) {

  const color = clickedTab.getAttribute("data-color") || "primary";
  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.remove("active");
    link.className = link.className
      .split(" ")
      .filter(cls => !cls.startsWith("bg-"))
      .join(" ");
  });

  clickedTab.classList.add("active", "bg-" + color);
}

//Set Sidebar Color
function sidebarColor(badge) {
  const currentColor = badge.getAttribute("data-color");

  // Remove active from all badges
  document.querySelectorAll(".badge.filter").forEach(b => {
    b.classList.remove("active");
  });
  badge.classList.add("active");

  // Apply new color to active tab only
  const activeTab = document.querySelector(".nav-link.active");
  if (activeTab) {
    activeTab.className = activeTab.className
      .split(" ")
      .filter(cls => !cls.startsWith("bg-"))
      .join(" ");
    activeTab.classList.add("bg-" + currentColor);
  }

  // Also re-tints the sidebar's own background gradient to match (see
  // .sidenav-accent-* rules in custom.css) - previously the accent
  // swatches only ever recolored the active nav pill, leaving the
  // sidebar's gradient a fixed purple regardless of which accent was
  // picked.
  const sidenav = document.getElementById('sidenav-main');
  if (sidenav) {
    sidenav.className = sidenav.className
      .split(" ")
      .filter(cls => !cls.startsWith("sidenav-accent-"))
      .join(" ");
    sidenav.classList.add("sidenav-accent-" + currentColor);
  }
}

// Cache of "DTMashup*" themes from qlik.getThemeList(), populated by
// renderThemeSwitcher() below once that resolves. Looked up by
// applyAppearance() so a single accent-color click can also drive the
// matching Qlik theme, instead of needing a second, separate theme picker.
let mashupThemeList = [];

// Exact naming convention this tenant's Qlik themes follow: "DTMashup" +
// the capitalized accent name (DTMashupPrimary, DTMashupDark,
// DTMashupInfo, DTMashupSuccess, DTMashupWarning, DTMashupDanger).
const ACCENT_THEME_SUFFIX = {
  primary: 'Primary',
  dark: 'Dark',
  exchange: 'Exchange',
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger'
};

// Picks which cached Qlik theme goes with a given accent color, by exact
// "DTMashup<Suffix>" name match. Falls back to a looser dark/non-dark split
// (same heuristic as before) if the exact name isn't in the list, so this
// still degrades gracefully rather than refusing to apply anything.
function resolveThemeIdForColor(colorName) {
  if (!mashupThemeList.length) {
    return null;
  }

  const suffix = ACCENT_THEME_SUFFIX[colorName] || '';
  const exactPattern = new RegExp('^DTMashup' + suffix + '$', 'i');
  const exactMatch = mashupThemeList.find((theme) => exactPattern.test(theme.name || theme.id || ''));
  if (exactMatch) {
    return exactMatch.name || exactMatch.id;
  }

  const wantsDark = colorName === 'dark' || colorName === 'exchange';
  const looseMatch = mashupThemeList.find((theme) => {
    const id = theme.name || theme.id || '';
    return wantsDark ? /dark/i.test(id) : !/dark/i.test(id);
  });
  const theme = looseMatch || mashupThemeList[0];
  return theme.name || theme.id;
}

// Applies a Qlik Sense theme (native chart colors/fonts) by id, and re-skins
// the mashup's own UI to match. window.qlik is set by qliksense.js once the
// Capability API has loaded - if that isn't ready yet, this silently no-ops
// with a console warning rather than throwing.
function applyQlikTheme(themeId, colorName) {
  if (!themeId) {
    return;
  }

  // "Dark" fully re-themes the app's background/surfaces/text (see the
  // --mu-* variable overrides under body.mu-dark in custom.css) - the
  // other accents stay in light mode but retint every component built on
  // --mu-primary/--mu-primary-dark/--mu-primary-light (buttons, focus
  // rings, chips, highlights, etc. throughout the app) via the matching
  // body.mu-accent-* class instead of just the sidebar/nav pill.
  document.body.classList.toggle('mu-dark', colorName === 'exchange' || /dark/i.test(themeId));

  document.body.className = document.body.className
    .split(' ')
    .filter((cls) => !cls.startsWith('mu-accent-'))
    .join(' ');
  if (colorName && colorName !== 'primary' && colorName !== 'dark') {
    document.body.classList.add('mu-accent-' + colorName);
  }

  if (window.qlik && window.qlik.theme && typeof window.qlik.theme.apply === 'function') {
    window.qlik.theme.apply(themeId);
  } else {
    console.warn('applyQlikTheme: Qlik API not ready yet - try again once the app has loaded.');
  }
}

// One click on an "Appearance" swatch (Mashup Settings dropdown) now does
// both jobs that used to need two separate controls: re-tints the accent
// color (sidebarColor()) AND switches the paired Qlik theme/light-dark mode
// (applyQlikTheme()) - saving a second trip into a "Qlik theme" list for
// the common case of just wanting dark mode.
function applyAppearance(badge) {
  sidebarColor(badge);

  const colorName = badge.getAttribute('data-color');
  const themeId = resolveThemeIdForColor(colorName);
  if (!themeId) {
    console.warn('applyAppearance: no Qlik theme available yet to pair with this color - try again once the app has loaded.');
    return;
  }
  applyQlikTheme(themeId, colorName);
}

// Caches the "DTMashup*" themes from qlik.getThemeList() (see
// https://help.qlik.com/en-US/sense-developer/.../getThemeList-method.htm),
// called from qliksense.js once that resolves. Only keeps themes whose name
// or title contains "DTMashup" - previously matched anything containing
// just "mashup", which could also pick up other tenants'/apps' themes that
// happen to share that word but aren't meant for this specific mashup's
// naming convention (DTMashup/DTMashupDark/DTMashupInfo/etc). No separate
// UI to render any more - see applyAppearance() and the single "Appearance"
// swatches in the settings dropdown.
function renderThemeSwitcher(themeList) {
  const list = Array.isArray(themeList) ? themeList : [];
  mashupThemeList = list.filter((theme) => {
    const id = theme.name || theme.id || '';
    const label = theme.title || theme.label || '';
    return /dtmashup/i.test(id) || /dtmashup/i.test(label);
  });

  const hint = document.getElementById('appearanceThemeHint');
  if (hint && !mashupThemeList.length) {
    hint.textContent = 'No theme with "DTMashup" in its name was found - accent color only.';
  }
}

// Toggles the whole page (documentElement) in/out of the browser's native
// Fullscreen API. Icon/tooltip on the trigger button are kept in sync via
// the "fullscreenchange" listener below, so exiting with Esc (not just the
// button) still updates the icon correctly.
function togglePageFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.warn('Unable to enter fullscreen:', err);
    });
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', function () {
  const btn = document.getElementById('pageFullscreenToggle');
  if (!btn) {
    return;
  }
  const icon = btn.querySelector('.mu-icon');
  const isFullscreen = !!document.fullscreenElement;
  if (icon) {
    setIconName(icon, isFullscreen ? 'fullscreen_exit' : 'fullscreen');
  }
  btn.title = isFullscreen ? 'Exit full screen' : 'Full screen';
});

// Set Navbar Fixed
function navbarFixed(el) {
  const classes = ['position-sticky', 'blur', 'shadow-blur', 'mt-4', 'left-auto', 'top-1', 'z-index-sticky'];
  const navbar = document.getElementById('navbarBlur');

  if (!el.getAttribute("checked")) {
    navbar.classList.add(...classes);
    navbar.setAttribute('navbar-scroll', 'true');
    navbarBlurOnScroll('navbarBlur');
    el.setAttribute("checked", "true");
  } else {
    navbar.classList.remove(...classes);
    navbar.setAttribute('navbar-scroll', 'false');
    navbarBlurOnScroll('navbarBlur');
    el.removeAttribute("checked");
  }
};


// Navbar blur on scroll
function navbarBlurOnScroll(id) {
  const navbar = document.getElementById(id);
  // navbarFixed() (above) writes the "navbar-scroll" attribute when the
  // Mashup Settings toggle is flipped - this used to read a DIFFERENT
  // attribute name ("data-scroll", a leftover from the vendor template)
  // that nothing ever wrote, so it always read the HTML's static
  // data-scroll="true" regardless of the toggle's actual on/off state.
  // That's exactly why turning the toggle on vs off produced inconsistent
  // results - the scroll handler being (re)registered below never
  // actually reflected which state the user picked.
  const navbarScrollActive = navbar ? navbar.getAttribute("navbar-scroll") : false;
  const scrollDistance = 5;
  const classes = ['blur', 'shadow-blur', 'left-auto'];
  const toggleClasses = ['shadow-none'];

  if (navbarScrollActive == 'true') {
    window.onscroll = debounce(function () {
      if (window.scrollY > scrollDistance) {
        blurNavbar();
      } else {
        transparentNavbar();
      }
    }, 10);
  } else {
    window.onscroll = debounce(function () {
      transparentNavbar();
    }, 10);
  }

  // Reflects the current state immediately rather than waiting for the
  // next scroll event - without this, flipping the toggle while not
  // actively scrolling left the nav link colors/shadow classes stale
  // (matching whatever the PREVIOUS toggle state last set on a scroll)
  // until the user happened to scroll afterwards, which is the other half
  // of why toggling looked inconsistent.
  if (navbarScrollActive == 'true' && window.scrollY > scrollDistance) {
    blurNavbar();
  } else {
    transparentNavbar();
  }

  const isWindows = navigator.platform.indexOf('Win') > -1;

  if (isWindows) {
    var content = document.querySelector('.main-content');
    if (navbarScrollActive == 'true') {
      content.addEventListener('ps-scroll-y', debounce(function () {
        if (content.scrollTop > scrollDistance) {
          blurNavbar();
        } else {
          transparentNavbar();
        }
      }, 10));
    } else {
      content.addEventListener('ps-scroll-y', debounce(function () {
        transparentNavbar();
      }, 10));
    }
  }

  function blurNavbar() {
    navbar.classList.add(...classes)
    navbar.classList.remove(...toggleClasses)

    toggleNavLinksColor('blur');
  }

  function transparentNavbar() {
    navbar.classList.remove(...classes)
    navbar.classList.add(...toggleClasses)

    toggleNavLinksColor('transparent');
  }

  function toggleNavLinksColor(type) {
    let navLinks = document.querySelectorAll('.navbar-main .nav-link')
    let navLinksToggler = document.querySelectorAll('.navbar-main .sidenav-toggler-line')

    if (type === "blur") {
      navLinks.forEach(element => {
        element.classList.remove('text-body')
      });

      navLinksToggler.forEach(element => {
        element.classList.add('bg-dark')
      });
    } else if (type === "transparent") {
      navLinks.forEach(element => {
        element.classList.add('text-body')
      });

      navLinksToggler.forEach(element => {
        element.classList.remove('bg-dark')
      });
    }
  }
}

// Debounce Function
// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
function debounce(func, wait, immediate) {
  let timeout;
  return function () {
    const context = this,
      args = arguments;
    const later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
};




function initNavs() {
  // Tabs navigation
  const total = document.querySelectorAll('.nav-pills');
  total.forEach(function (item, i) {
    let moving_div = document.createElement('div');
    const first_li = item.querySelector('li:first-child .nav-link');
    const tab = first_li.cloneNode();
    tab.innerHTML = "-";

    moving_div.classList.add('moving-tab', 'position-absolute', 'nav-link');
    moving_div.appendChild(tab);
    item.appendChild(moving_div);

    moving_div.style.padding = '0px';
    moving_div.style.width = item.querySelector('li:nth-child(1)').offsetWidth + 'px';
    moving_div.style.transform = 'translate3d(0px, 0px, 0px)';
    moving_div.style.transition = '.5s ease';

    item.onmouseover = function (event) {
      let target = getEventTarget(event);
      let li = target.closest('li'); // get reference
      if (li) {
        let nodes = Array.from(li.closest('ul').children); // get array
        let index = nodes.indexOf(li) + 1;
        item.querySelector('li:nth-child(' + index + ') .nav-link').onclick = function () {
          moving_div = item.querySelector('.moving-tab');
          let sum = 0;
          if (item.classList.contains('flex-column')) {
            for (var j = 1; j <= nodes.indexOf(li); j++) {
              sum += item.querySelector('li:nth-child(' + j + ')').offsetHeight;
            }
            moving_div.style.transform = 'translate3d(0px,' + sum + 'px, 0px)';
            moving_div.style.height = item.querySelector('li:nth-child(' + j + ')').offsetHeight;
          } else {
            for (var j = 1; j <= nodes.indexOf(li); j++) {
              sum += item.querySelector('li:nth-child(' + j + ')').offsetWidth;
            }
            moving_div.style.transform = 'translate3d(' + sum + 'px, 0px, 0px)';
            moving_div.style.width = item.querySelector('li:nth-child(' + index + ')').offsetWidth + 'px';
          }
        }
      }
    }
  });
}


function getEventTarget(e) {
  e = e || window.event;
  return e.target || e.srcElement;
}


function navbarColorOnResize() {
  // Resize navbar color depends on configurator active type of sidenav
  const referenceButtons = document.querySelector('[data-class]');
  if (window.innerWidth > 1200) {
    if (referenceButtons?.classList.contains('active') && referenceButtons?.getAttribute('data-class') === 'bg-transparent') {
      sidenav.classList.remove('bg-white');
    } else {
      sidenav.classList.add('bg-white');
    }
  } else {
    sidenav.classList.add('bg-white');
    sidenav.classList.remove('bg-transparent');
  }
}

function toggleSidenav() {
  if (body.classList.contains(className)) {
    body.classList.remove(className);
    setTimeout(function () {
      sidenav.classList.remove('bg-white');
    }, 100);
    sidenav.classList.remove('bg-transparent');

  } else {
    body.classList.add(className);
    sidenav.classList.add('bg-white');
    sidenav.classList.remove('bg-transparent');
    iconSidenav.classList.remove('d-none');
  }
}



// Floating chat assistant button - opens/closes the right-side slide-in
// panel. @qlik/embed-web-components is only injected the FIRST time it's
// actually needed (a user picks an assistant, not just on opening the
// panel) - loading it upfront alongside require.js (the classic Capability
// API's loader, used everywhere else in this mashup) raced with it during
// boot and broke qlik.openApp app-wide. By the time a user gets this far,
// that bootstrap has long since finished, so there's no race left to lose.
let chatAssistantScriptLoaded = false;

// The mashup has one assistant. Keeping this as a registry preserves the
// existing picker/embed flow while preventing a second assistant from being
// offered in the UI.
const CHAT_ASSISTANTS = {
  primary: {
    id: '423459d7-20c6-4dca-838c-183b935ca018',
    label: 'Construction Safety Assistant',
    shortLabel: 'Assistant',
    description: 'Ask questions about construction incidents, safety, inspections and compliance.',
    icon: 'chat'
  }
};

// null until a user picks one for the first time (see renderChatAssistantBody()
// below, which shows the picker while this is null).
let chatAssistantSelectedKey = null;

// "qlik-light" or "qlik-dark" - the only two values qlik-embed's own
// `appearance` attribute supports (confirmed via qlik.dev/embed/qlik-embed/
// parameters/). Tracked separately from the DOM so the panel's toggle
// button works correctly even before any assistant embed exists yet (the
// picker screen), and so a later re-render picks up whichever mode was
// last chosen instead of always resetting to light.
let chatAssistantAppearance = 'qlik-light';

function ensureChatAssistantScriptLoaded() {
  if (chatAssistantScriptLoaded) {
    return;
  }
  chatAssistantScriptLoaded = true;

  const script = document.createElement('script');
  script.crossOrigin = 'anonymous';
  script.type = 'application/javascript';
  script.src = 'https://cdn.jsdelivr.net/npm/@qlik/embed-web-components@1/dist/index.min.js';
  script.setAttribute('data-host', 'https://dtworks.eu.qlikcloud.com');
  script.setAttribute('data-web-integration-id', 'XPEePd2Ykd-yJO6tBms9AoNtc0dgt12o');
  script.setAttribute('data-cross-site-cookies', 'true');
  document.head.appendChild(script);
}

// Shows the "which assistant?" picker until one has been chosen, then the
// chosen assistant's embed (with a switcher pinned above it) from then on.
function renderChatAssistantBody() {
  if (!chatAssistantSelectedKey) {
    renderChatAssistantPicker();
  } else {
    renderChatAssistantEmbedElement();
  }
}

function renderChatAssistantPicker() {
  const body = document.getElementById('chatAssistantPanelBody');
  if (!body) {
    return;
  }

  body.innerHTML = `
    <div class="chat-assistant-picker">
      <p class="chat-assistant-picker-intro">Which assistant would you like to talk to?</p>
      ${Object.keys(CHAT_ASSISTANTS).map(function (key) {
        const assistant = CHAT_ASSISTANTS[key];
        return `
          <button type="button" class="chat-assistant-picker-card" data-assistant-key="${key}">
            <span class="chat-assistant-picker-icon">${iconSvg(assistant.icon)}</span>
            <span class="chat-assistant-picker-text">
              <span class="chat-assistant-picker-title">${assistant.label}</span>
              <span class="chat-assistant-picker-desc">${assistant.description}</span>
            </span>
            ${iconSvg('chevron_right', 'chat-assistant-picker-arrow')}
          </button>
        `;
      }).join('')}
    </div>
  `;

  body.querySelectorAll('.chat-assistant-picker-card').forEach(function (card) {
    card.addEventListener('click', function () {
      selectChatAssistant(card.getAttribute('data-assistant-key'));
    });
  });
}

function renderChatAssistantEmbedElement() {
  const body = document.getElementById('chatAssistantPanelBody');
  const assistant = CHAT_ASSISTANTS[chatAssistantSelectedKey];
  if (!body || !assistant) {
    return;
  }

  // No context/context-id attribute exists for ui="ai/agentic-assistant"
  // (confirmed against Qlik's own docs at qlik.dev/embed/qlik-embed/
  // parameters/ - the only "context" attribute, context___json, is an
  // unrelated analytics-chart interaction config, and thread-id only
  // applies to the older ui="ai/assistant" type). The "Where would you
  // like to start?" context picker is internal to the agentic assistant
  // itself and isn't currently exposed as an embeddable parameter.
  body.innerHTML = `
    <div class="chat-assistant-switcher">
      ${Object.keys(CHAT_ASSISTANTS).map(function (key) {
        const option = CHAT_ASSISTANTS[key];
        const isActive = key === chatAssistantSelectedKey;
        return `
          <button type="button" class="chat-assistant-switcher-btn${isActive ? ' active' : ''}" data-assistant-key="${key}" title="${isActive ? option.label : 'Switch to ' + option.label}">
            ${iconSvg(option.icon)}<span>${option.shortLabel}</span>
          </button>
        `;
      }).join('')}
    </div>
    <div class="chat-assistant-embed-wrap">
      <qlik-embed
        id="qlikAnswersEmbed"
        ui="ai/agentic-assistant"
        assistant-id="${assistant.id}"
        appearance="${chatAssistantAppearance}">
      </qlik-embed>
    </div>
  `;

  body.querySelectorAll('.chat-assistant-switcher-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectChatAssistant(btn.getAttribute('data-assistant-key'));
    });
  });
}

// Picks (or switches to) an assistant - called both from the initial
// picker cards and from the top switcher pills once one is already active.
function selectChatAssistant(key) {
  if (!CHAT_ASSISTANTS[key] || key === chatAssistantSelectedKey) {
    return;
  }
  ensureChatAssistantScriptLoaded();
  chatAssistantSelectedKey = key;
  renderChatAssistantEmbedElement();
}

// Flips the embedded assistant between qlik-embed's own "qlik-light" and
// "qlik-dark" appearance - independent of this mashup's own .mu-dark mode,
// since the assistant is a separate web component with its own theming,
// not something --mu-* variables reach into. Setting the attribute directly
// on the already-rendered element does NOT re-theme it live (confirmed not
// working), so this rebuilds the <qlik-embed> element from scratch with the
// new appearance instead - the tradeoff is that an in-progress conversation
// resets when toggled, since there's no documented API to re-theme in
// place.
function toggleChatAssistantAppearance(btn) {
  chatAssistantAppearance = chatAssistantAppearance === 'qlik-light' ? 'qlik-dark' : 'qlik-light';

  // Only the embed view (not the picker) has anything to rebuild.
  if (chatAssistantSelectedKey) {
    renderChatAssistantEmbedElement();
  }

  // Confirmed working for the embed itself, but the panel's OWN chrome
  // (header, close/toggle buttons, picker, switcher) stayed light
  // regardless - this mirrors the assistant's mode onto
  // <body data-qlik-theme="qlik-light|qlik-dark"> so the panel around it
  // can follow suit too (see the body[data-qlik-theme="qlik-dark"] rules
  // in custom.css), independent of this mashup's own separate .mu-dark
  // app-wide dark mode.
  document.body.setAttribute('data-qlik-theme', chatAssistantAppearance);

  const isDark = chatAssistantAppearance === 'qlik-dark';
  const icon = btn.querySelector('.mu-icon');
  if (icon) {
    setIconName(icon, isDark ? 'light_mode' : 'dark_mode');
  }
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

// Dashboard NL charts (DASHBOARD-CHART-NL-1..3) are collapsed by default -
// still rendered as normal by app.getObject() (their container never gets
// display: none, just max-height: 0 + overflow: hidden - see
// .dashboard-nl-collapse in custom.css), so there's nothing to
// re-render when expanded, only a resize. Qlik sizes a chart's internal
// SVG/canvas off its container's dimensions at render time and won't
// redraw on its own just because a CSS class later makes that container
// taller, so this nudges it to redraw once the expand transition finishes.
function toggleDashboardNlChart(btn) {
  // The toggle button and .dashboard-nl-collapse now live in separate
  // sibling card-body elements (title/button first, chart, then the
  // collapse), so the lookup has to scope to the whole .card, not just
  // the button's own immediate card-body.
  const wrapper = btn.closest('.card').querySelector('.dashboard-nl-collapse');
  if (!wrapper) {
    return;
  }

  const isOpen = wrapper.classList.toggle('show');
  const icon = btn.querySelector('.mu-icon');
  if (icon) {
    setIconName(icon, isOpen ? 'expand_less' : 'expand_more');
  }
  btn.title = isOpen ? 'Hide details' : 'Show details';

  if (window.qlik && typeof window.qlik.resize === 'function') {
    setTimeout(function () {
      window.qlik.resize();
    }, 320);
  }
}

// Welcome banner (hero-banner) collapsed by default - only the "Welcome
// back" title shows until expanded. Toggles a single class on the whole
// .hero-banner card (not just the text underneath it) - custom.css keys
// the icon, the reload-time/summary text, AND the card's own padding off
// this one class, so collapsing actually shrinks the card down to a slim
// bar and gives back real vertical space, not just hides the message
// inside an otherwise still-full-size card. No Qlik object involved here
// (unlike toggleDashboardNlChart above), so no resize() call needed - it's
// plain text/markup either way.
function toggleHeroBanner(btn) {
  const card = btn.closest('.hero-banner');
  if (!card) {
    return;
  }

  const isExpanded = card.classList.toggle('is-expanded');
  const icon = btn.querySelector('.mu-icon');
  if (icon) {
    setIconName(icon, isExpanded ? 'expand_less' : 'expand_more');
  }
  btn.title = isExpanded ? 'Hide details' : 'Show details';
}

function initChatAssistantPanel() {
  const fab = document.getElementById('chatAssistantFab');
  const panel = document.getElementById('chatAssistantPanel');
  const closeBtn = document.getElementById('chatAssistantPanelClose');
  const themeToggleBtn = document.getElementById('chatAssistantPanelThemeToggle');
  if (!fab || !panel) {
    return;
  }

  // Renders the panel body (picker, then whichever assistant gets picked)
  // exactly once - re-opening the panel later should never reset an
  // in-progress conversation or bounce a user back to the picker screen.
  let chatAssistantBodyInitialized = false;
  const togglePanel = () => {
    if (!chatAssistantBodyInitialized) {
      chatAssistantBodyInitialized = true;
      renderChatAssistantBody();
    }
    panel.classList.toggle('show');
  };

  fab.addEventListener('click', togglePanel);
  if (closeBtn) {
    closeBtn.addEventListener('click', () => panel.classList.remove('show'));
  }
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => toggleChatAssistantAppearance(themeToggleBtn));
  }
}

// Welcome banner "last reloaded" stamp - fires immediately on page load as
// a placeholder (before window.qlik even exists) so the banner never sits
// on "Loading..." for long. renderHeroBannerAppInfo() (qliksense.js)
// overwrites this with the app's REAL last-reload time from
// app.getAppLayout() once that resolves, which is what actually matters -
// this is just today's date/now as a same-session fallback if that call is
// slow or fails.
function renderHeroBannerLastReloaded() {
  const el = document.getElementById('heroBannerLastReloaded');
  if (!el) {
    return;
  }
  const now = new Date();
  const datePart = now.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  const timePart = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  el.textContent = 'Last reloaded ' + datePart + ' at ' + timePart;
}

$(window).on('load', function () {
  // Verify navbar blur on scroll
  if (document.getElementById('navbarBlur')) {
    navbarBlurOnScroll('navbarBlur');
  }

  renderHeroBannerLastReloaded();

  // initialization of Tooltips - .navbar-icon-btn[title]/.topbar-profile[title]
  // covers icons whose data-bs-toggle attribute is already claimed by a
  // dropdown (Current Selections, Bookmarks, Mashup Settings) - a single
  // attribute can only drive one Bootstrap component's auto-init, but
  // calling .tooltip() here directly isn't limited to that and works
  // alongside the dropdown behaviour just fine.
  $(function () {
    $('[data-bs-toggle="tooltip"], .navbar-icon-btn[title], .topbar-profile[title]').tooltip()
  })


  // adding on inputs attributes for calling the focused and defocused functions
  if (document.querySelectorAll('.input-group').length != 0) {
    var allInputs = document.querySelectorAll('input.form-control');
    allInputs.forEach(el => setAttributes(el, {
      "onfocus": "focused(this)",
      "onfocusout": "defocused(this)"
    }));
  }


  // Fixed Plugin
  if (document.querySelector('.fixed-plugin')) {
    const fixedPlugin = document.querySelector('.fixed-plugin');
    const fixedPluginButton = document.querySelector('.fixed-plugin-button');
    const fixedPluginButtonNav = document.querySelector('.fixed-plugin-button-nav');
    const fixedPluginCloseButton = document.querySelectorAll('.fixed-plugin-close-button');
    const navbar = document.getElementById('navbarBlur');
    const buttonNavbarFixed = document.getElementById('navbarFixed');

    const toggleFixedPlugin = () => fixedPlugin.classList.toggle('show');

    if (fixedPluginButton) {
      fixedPluginButton.onclick = toggleFixedPlugin;
    }

    if (fixedPluginButtonNav) {
      fixedPluginButtonNav.onclick = toggleFixedPlugin;
    }

    fixedPluginCloseButton.forEach((el) => {
      el.onclick = () => fixedPlugin.classList.remove('show');
    })

    // Deliberately no "click outside to close" listener here. Qlik filter
    // objects (FILTER-1..5) can expand a value list into a portal-rendered
    // popup that lives outside .fixed-plugin's DOM subtree entirely (not a
    // descendant of it), so any outside-click check - even one immune to
    // Qlik re-rendering the clicked element mid-click - would still see
    // that popup's clicks as "outside" and close the panel while the user
    // is mid-selection. Closing is explicit only: the close button, or
    // re-clicking the toggle.

    if (navbar) {
      if (navbar.getAttribute('data-scroll') == 'true' && buttonNavbarFixed) {
        buttonNavbarFixed.setAttribute("checked", "true");
      }
    }



  }


  initChatAssistantPanel();

  setTimeout(() => initNavs(), 100);

  const inputs = document.querySelectorAll('input');

  for (let i = 0; i < inputs.length; i++) {
    inputs[i].addEventListener('focus', function (e) {
      this.parentElement.classList.add('is-focused');
    }, false);

    inputs[i].onkeyup = function (e) {
      if (this.value != "") {
        this.parentElement.classList.add('is-filled');
      } else {
        this.parentElement.classList.remove('is-filled');
      }
    };

    inputs[i].addEventListener('focusout', function (e) {
      if (this.value != "") {
        this.parentElement.classList.add('is-filled');
      }
      this.parentElement.classList.remove('is-focused');
    }, false);
  }

  // Ripple Effect
  const ripples = document.querySelectorAll('.btn');

  for (let i = 0; i < ripples.length; i++) {
    ripples[i].addEventListener('click', (e) => {
      const targetEl = e.target;
      const rippleDiv = document.createElement('span');
      rippleDiv.classList.add('ripple');
      rippleDiv.style.width = rippleDiv.style.height = `${Math.max(targetEl.offsetWidth, targetEl.offsetHeight)}px`;
      targetEl.appendChild(rippleDiv);

      rippleDiv.style.left = `${e.offsetX - rippleDiv.offsetWidth / 2}px`;
      rippleDiv.style.top = `${e.offsetY - rippleDiv.offsetHeight / 2}px`;
      setTimeout(() => rippleDiv.parentElement.removeChild(rippleDiv), 600);
    }, false);
  }



  if (iconNavbarSidenav) {
    iconNavbarSidenav.addEventListener("click", toggleSidenav);
  }

  if (iconSidenav) {
    iconSidenav.addEventListener("click", toggleSidenav);
  }



  if (sidenav) {
    window.addEventListener("resize", navbarColorOnResize);
  }

  // side bullets

  const indicators = document.querySelectorAll(".indicator");
  const sections = document.querySelectorAll("section");

  if (indicators) {
    const resetCurrentActiveIndicator = () => {
      const activeIndicator = document.querySelector(".indicator.active");
      if (activeIndicator) {
        activeIndicator.classList.remove("active");
      }
    };

    const onSectionLeavesViewport = (section) => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              resetCurrentActiveIndicator();
              const element = entry.target;
              const indicator = document.querySelector(`a[href='#${element.id}']`);
              indicator.classList.add("active");
              return;
            }
          });
        }, {
        root: null,
        rootMargin: "0px",
        threshold: 0.75
      }
      );
      observer.observe(section);
    };

    indicators.forEach((indicator) => {
      indicator.addEventListener("click", function (event) {
        event.preventDefault();
        document
          .querySelector(this.getAttribute("href"))
          .scrollIntoView({
            behavior: "smooth"
          });
        resetCurrentActiveIndicator();
        this.classList.add("active");
      });
    });

    sections.forEach(onSectionLeavesViewport);
  }

  window.addEventListener("load", navbarColorOnResize);
});

$(window).resize(function () {
  // Tabs navigation
  const total = document.querySelectorAll('.nav-pills');
  total.forEach(function (item, i) {
    item.querySelector('.moving-tab').remove();
    const moving_div = document.createElement('div');
    const tab = item.querySelector(".nav-link.active").cloneNode();
    tab.innerHTML = "-";

    moving_div.classList.add('moving-tab', 'position-absolute', 'nav-link');
    moving_div.appendChild(tab);

    item.appendChild(moving_div);

    moving_div.style.padding = '0px';
    moving_div.style.transition = '.5s ease';

    const li = item.querySelector(".nav-link.active").parentElement;

    if (li) {
      const nodes = Array.from(li.closest('ul').children); // get array
      const index = nodes.indexOf(li) + 1;

      let sum = 0;
      // `j` is intentionally function-scoped (var) - its post-loop value is reused below
      if (item.classList.contains('flex-column')) {
        for (var j = 1; j <= nodes.indexOf(li); j++) {
          sum += item.querySelector('li:nth-child(' + j + ')').offsetHeight;
        }
        moving_div.style.transform = `translate3d(0px, ${sum}px, 0px)`;
        moving_div.style.width = `${item.querySelector('li:nth-child(' + index + ')').offsetWidth}px`;
        moving_div.style.height = item.querySelector('li:nth-child(' + j + ')').offsetHeight;
      } else {
        for (var j = 1; j <= nodes.indexOf(li); j++) {
          sum += item.querySelector('li:nth-child(' + j + ')').offsetWidth;
        }
        moving_div.style.transform = `translate3d(${sum}px, 0px, 0px)`;
        moving_div.style.width = `${item.querySelector('li:nth-child(' + index + ')').offsetWidth}px`;
      }
    }
  });

  if (window.innerWidth < 991) {
    total.forEach(function (item, i) {
      if (!item.classList.contains('flex-column')) {
        item.classList.remove('flex-row');
        item.classList.add('flex-column', 'on-resize');
        const li = item.querySelector(".nav-link.active").parentElement;
        const nodes = Array.from(li.closest('ul').children); // get array
        let sum = 0;
        for (var j = 1; j <= nodes.indexOf(li); j++) {
          sum += item.querySelector('li:nth-child(' + j + ')').offsetHeight;
        }
        const moving_div = document.querySelector('.moving-tab');
        moving_div.style.width = `${item.querySelector('li:nth-child(1)').offsetWidth}px`;
        moving_div.style.transform = `translate3d(0px, ${sum}px, 0px)`;

      }
    });
  } else {
    total.forEach(function (item, i) {
      if (item.classList.contains('on-resize')) {
        item.classList.remove('flex-column', 'on-resize');
        item.classList.add('flex-row');
        const li = item.querySelector(".nav-link.active").parentElement;
        const nodes = Array.from(li.closest('ul').children); // get array
        const index = nodes.indexOf(li) + 1;
        let sum = 0;
        for (var j = 1; j <= nodes.indexOf(li); j++) {
          sum += item.querySelector('li:nth-child(' + j + ')').offsetWidth;
        }
        const moving_div = document.querySelector('.moving-tab');
        moving_div.style.transform = `translate3d(${sum}px, 0px, 0px)`;
        moving_div.style.width = `${item.querySelector('li:nth-child(' + index + ')').offsetWidth}px`;
      }
    })
  }


  // Function to remove flex row on mobile devices
  if (window.innerWidth < 991) {
    total.forEach(function (item, i) {
      if (item.classList.contains('flex-row')) {
        item.classList.remove('flex-row');
        item.classList.add('flex-column', 'on-resize');
      }
    });
  }

  $('#mainTab a[data-bs-toggle="tab"]').on('shown.bs.tab', function (event) {
    $('.tab-title').text($(event.target).find('span').text());
  });
});






