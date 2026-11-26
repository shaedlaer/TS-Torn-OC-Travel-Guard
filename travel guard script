// ==UserScript==
// @name         Torn OC Travel Guard
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Turns the Travel button into a red WARNING button and calculates exact OC delay time before allowing flight.
// @author       Til Shaedlaer
// @match        https://www.torn.com/page.php?sid=travel*
// @match        https://www.torn.com/travelagency.php*
// @include      *torn.com/page.php*sid=travel*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const OC_WARNING_PATTERNS = [
        /organized crime/i,
        /will be initiated in/i,
        /ready to be initiated/i,
        /scheduled to begin/i,
        /participating in an organized crime/i
    ];

    const style = document.createElement('style');
    style.textContent = `
        @keyframes oc-pulse {
            0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.8); }
            70% { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0); }
            100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
        }
        .oc-guard-warning-btn {
            background: linear-gradient(180deg, #dc2626 0%, #991b1b 100%) !important;
            color: #ffffff !important;
            font-weight: 800 !important;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8) !important;
            border: 1px solid #fca5a5 !important;
            letter-spacing: 0.5px !important;
            cursor: pointer !important;
            animation: oc-pulse 1.8s infinite;
            transition: transform 0.1s ease, filter 0.15s ease;
        }
        .oc-guard-warning-btn:hover {
            filter: brightness(1.15);
        }
        .oc-guard-warning-btn:active {
            transform: scale(0.98);
        }
    `;
    document.head.appendChild(style);

    function parseDurationToMinutes(text) {
        if (!text) return null;

        const colonMatch = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
        if (colonMatch) {
            const hrs = parseInt(colonMatch[1], 10);
            const mins = parseInt(colonMatch[2], 10);
            const secs = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0;
            return (hrs * 60) + mins + Math.round(secs / 60);
        }

        let totalMinutes = 0;
        let matched = false;

        const daysMatch = text.match(/(\d+)\s*(?:day|days|d)\b/i);
        if (daysMatch) {
            totalMinutes += parseInt(daysMatch[1], 10) * 1440;
            matched = true;
        }

        const hoursMatch = text.match(/(\d+)\s*(?:hour|hours|hr|hrs|h)\b/i);
        if (hoursMatch) {
            totalMinutes += parseInt(hoursMatch[1], 10) * 60;
            matched = true;
        }

        const minsMatch = text.match(/(\d+)\s*(?:minute|minutes|min|mins|m)\b/i);
        if (minsMatch) {
            totalMinutes += parseInt(minsMatch[1], 10);
            matched = true;
        }

        return matched ? totalMinutes : null;
    }

    function formatMinutes(totalMins) {
        if (totalMins === null || isNaN(totalMins)) return null;
        if (totalMins <= 0) return '0 minutes';

        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;

        const parts = [];
        if (hrs > 0) parts.push(`${hrs} hour${hrs !== 1 ? 's' : ''}`);
        if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
        return parts.join(' and ');
    }

    function extractOCStartMinutes(text) {
        if (!text) return null;
        const initiatedMatch = text.match(/(?:initiated|start|begin)\s+in\s+([^.]+)/i);
        if (initiatedMatch) {
            return parseDurationToMinutes(initiatedMatch[1]);
        }
        return parseDurationToMinutes(text);
    }

    function extractOneWayFlightMinutes(text) {
        if (!text) return null;
        const reachMatch = text.match(/reach your destination in\s+(?:around\s+)?([^.]+)/i);
        if (reachMatch) {
            return parseDurationToMinutes(reachMatch[1]);
        }
        return null;
    }

    // Walk up from the Travel button to find the tightest container holding the confirmation copy
    function findNearestContextText(button) {
        let current = button.parentElement;
        while (current && current !== document.body) {
            const text = current.innerText || current.textContent || '';
            if (OC_WARNING_PATTERNS.some(rx => rx.test(text)) && text.length < 2500) {
                return text;
            }
            current = current.parentElement;
        }
        return document.body.innerText || '';
    }

    function guardTravelButton(travelBtn) {
        if (travelBtn.dataset.ocGuardApplied === 'true') return;

        const contextText = findNearestContextText(travelBtn);
        if (!OC_WARNING_PATTERNS.some(rx => rx.test(contextText))) return;

        travelBtn.dataset.ocGuardApplied = 'true';

        travelBtn.classList.add('oc-guard-warning-btn');
        if (travelBtn.tagName === 'INPUT') {
            travelBtn.value = '⚠️ WARNING: OC CONFLICT';
        } else {
            travelBtn.textContent = '⚠️ WARNING: OC CONFLICT';
        }

        let confirmed = false;

        travelBtn.addEventListener('click', function(e) {
            if (confirmed) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const freshText = findNearestContextText(travelBtn);
            const ocStartMins = extractOCStartMinutes(freshText);
            const oneWayMins = extractOneWayFlightMinutes(freshText);
            const roundTripMins = oneWayMins !== null ? oneWayMins * 2 : null;

            let popupMessage = '';

            if (ocStartMins !== null && roundTripMins !== null) {
                const delayMins = Math.max(0, roundTripMins - ocStartMins);
                const xStr = formatMinutes(ocStartMins);
                const yStr = formatMinutes(roundTripMins);
                const zStr = formatMinutes(delayMins);

                popupMessage =
                    `⚠️ ORGANIZED CRIME WARNING ⚠️\n\n` +
                    `Your OC is about to start in ${xStr}.\n` +
                    `Your travel time will take ${yStr} (there and back), making your OC-mates wait for ${zStr}.\n\n` +
                    `Are you sure you want to fly out?`;
            } else {
                popupMessage =
                    `⚠️ ORGANIZED CRIME WARNING ⚠️\n\n` +
                    `Your round-trip flight will make your OC-mates wait for you to return.\n\n` +
                    `Are you sure you want to fly out?`;
            }

            if (window.confirm(popupMessage)) {
                confirmed = true;
                travelBtn.click();
            }
        }, true);
    }

    function scanPage() {
        const buttons = document.querySelectorAll('button, a, input[type="submit"], [role="button"]');
        for (const btn of buttons) {
            const label = (btn.textContent || btn.value || '').trim();
            if (/^travel$/i.test(label) || /^⚠️ WARNING: OC CONFLICT$/i.test(label)) {
                guardTravelButton(btn);
            }
        }
    }

    const observer = new MutationObserver(() => {
        scanPage();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    scanPage();
})();
