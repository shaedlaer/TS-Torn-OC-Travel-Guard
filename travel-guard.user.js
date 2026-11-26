// ==UserScript==
// @name         Torn OC Travel Guard
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Reads live OC timer from Torn sidebar, shows OC vs. round-trip buffer badge, warns on conflict, and reverts automatically when safe.
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
        .oc-guard-status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 6px;
            padding: 4px 9px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.3;
            font-family: inherit;
        }
        .oc-guard-status-conflict {
            background: rgba(153, 27, 27, 0.28);
            border: 1px solid #ef4444;
            color: #fca5a5;
        }
        .oc-guard-status-safe {
            background: rgba(20, 83, 45, 0.35);
            border: 1px solid #22c55e;
            color: #86efac;
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

        const secsMatch = text.match(/(\d+)\s*(?:second|seconds|sec|secs|s)\b/i);
        if (secsMatch && !matched) {
            totalMinutes += Math.round(parseInt(secsMatch[1], 10) / 60);
            matched = true;
        }

        return matched ? totalMinutes : null;
    }

    function formatMinutes(totalMins) {
        if (totalMins === null || isNaN(totalMins)) return null;
        if (totalMins <= 0) return '0m';

        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;

        if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
        if (hrs > 0) return `${hrs}h`;
        return `${mins}m`;
    }

    function formatMinutesVerbose(totalMins) {
        if (totalMins === null || isNaN(totalMins)) return null;
        if (totalMins <= 0) return '0 minutes';

        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;

        const parts = [];
        if (hrs > 0) parts.push(`${hrs} hour${hrs !== 1 ? 's' : ''}`);
        if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
        return parts.join(' and ');
    }

    // Reads live OC timer from Torn's sidebar (e.g. "OC: 15m 26s" or "Organized Crime: 1h 20m")
    function findSidebarOCMinutes() {
        const sidebarRoots = document.querySelectorAll('#sidebar, [class*="sidebar"], [id*="sidebar"]');
        const roots = sidebarRoots.length > 0 ? Array.from(sidebarRoots) : [document.body];

        for (const root of roots) {
            const candidates = root.querySelectorAll('a, div, span, li, p');
            for (const el of candidates) {
                if (el.children.length > 3) continue;
                const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!raw || raw.length > 90) continue;

                const match = raw.match(/(?:\bOC\b|organized\s*crime)\s*:?\s*(.+)$/i);
                if (match) {
                    const mins = parseDurationToMinutes(match[1]);
                    if (mins !== null) return mins;
                }
            }
        }
        return null;
    }

    function extractOCStartMinutes(text) {
        if (!text) return null;
        const initiatedMatch = text.match(/(?:initiated|start|begin)\s+in\s+([^.]+)/i);
        if (initiatedMatch) {
            return parseDurationToMinutes(initiatedMatch[1]);
        }
        return null;
    }

    function extractOneWayFlightMinutes(text) {
        if (!text) return null;
        const reachMatch = text.match(/reach your destination in\s+(?:around\s+)?([^.]+)/i);
        if (reachMatch) {
            return parseDurationToMinutes(reachMatch[1]);
        }
        return null;
    }

    function findNearestContextText(button) {
        let current = button.parentElement;
        while (current && current !== document.body) {
            const text = current.innerText || current.textContent || '';
            if (text.length > 0 && text.length < 3000 && /reach your destination in/i.test(text)) {
                return text;
            }
            current = current.parentElement;
        }
        return document.body.innerText || '';
    }

    function snapshotOriginalButton(btn) {
        if (btn.dataset.ocOrigSaved === 'true') return;
        btn.dataset.ocOrigSaved = 'true';
        btn.dataset.ocOrigLabel = btn.tagName === 'INPUT' ? (btn.value || 'Travel') : (btn.textContent || 'Travel');
    }

    function setButtonNormal(btn) {
        btn.classList.remove('oc-guard-warning-btn');
        btn.dataset.ocGuardActive = 'false';
        if (btn.dataset.ocOrigLabel) {
            if (btn.tagName === 'INPUT') {
                btn.value = btn.dataset.ocOrigLabel;
            } else {
                btn.textContent = btn.dataset.ocOrigLabel;
            }
        }
    }

    function setButtonWarning(btn) {
        btn.classList.add('oc-guard-warning-btn');
        btn.dataset.ocGuardActive = 'true';
        if (btn.tagName === 'INPUT') {
            btn.value = '⚠️ WARNING: OC CONFLICT';
        } else {
            btn.textContent = '⚠️ WARNING: OC CONFLICT';
        }
    }

    function evaluateState(contextText) {
        const hasWarningText = OC_WARNING_PATTERNS.some(rx => rx.test(contextText));
        const sidebarMins = findSidebarOCMinutes();
        const warningMins = extractOCStartMinutes(contextText);

        // Prefer live sidebar OC countdown; fall back to warning sentence duration
        const ocStartMins = sidebarMins !== null ? sidebarMins : warningMins;
        const oneWayMins = extractOneWayFlightMinutes(contextText);
        const roundTripMins = oneWayMins !== null ? oneWayMins * 2 : null;

        let isConflict = false;
        if (ocStartMins !== null && roundTripMins !== null) {
            isConflict = roundTripMins > ocStartMins;
        } else if (hasWarningText) {
            isConflict = true;
        }

        return {
            isConflict,
            hasWarningText,
            ocStartMins,
            roundTripMins
        };
    }

    function updateStatusBadge(travelBtn, evaluation) {
        const parent = travelBtn.parentElement;
        if (!parent) return;

        let badge = parent.querySelector('.oc-guard-status-badge');

        if (evaluation.ocStartMins === null || evaluation.roundTripMins === null) {
            if (badge) badge.remove();
            return;
        }

        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'oc-guard-status-badge';
            travelBtn.insertAdjacentElement('afterend', badge);
        }

        const ocStr = formatMinutes(evaluation.ocStartMins);
        const rtStr = formatMinutes(evaluation.roundTripMins);
        const diffMins = evaluation.ocStartMins - evaluation.roundTripMins;

        if (diffMins < 0) {
            const lateStr = formatMinutes(Math.abs(diffMins));
            badge.className = 'oc-guard-status-badge oc-guard-status-conflict';
            badge.textContent = `⏱️ OC in ${ocStr} | Round-trip ${rtStr} (${lateStr} late)`;
        } else {
            const bufferStr = formatMinutes(diffMins);
            badge.className = 'oc-guard-status-badge oc-guard-status-safe';
            badge.textContent = `✅ OC in ${ocStr} | Round-trip ${rtStr} (${bufferStr} buffer)`;
        }
    }

    function attachInterceptorOnce(travelBtn) {
        if (travelBtn.dataset.ocListenerAttached === 'true') return;
        travelBtn.dataset.ocListenerAttached = 'true';

        let confirmed = false;

        travelBtn.addEventListener('click', function(e) {
            if (travelBtn.dataset.ocGuardActive !== 'true' || confirmed) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const freshText = findNearestContextText(travelBtn);
            const { ocStartMins, roundTripMins } = evaluateState(freshText);

            let popupMessage = '';

            if (ocStartMins !== null && roundTripMins !== null) {
                const delayMins = Math.max(0, roundTripMins - ocStartMins);
                const xStr = formatMinutesVerbose(ocStartMins);
                const yStr = formatMinutesVerbose(roundTripMins);
                const zStr = formatMinutesVerbose(delayMins);

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

    function syncTravelButton(travelBtn) {
        snapshotOriginalButton(travelBtn);
        attachInterceptorOnce(travelBtn);

        const contextText = findNearestContextText(travelBtn);
        const evaluation = evaluateState(contextText);

        if (evaluation.isConflict) {
            setButtonWarning(travelBtn);
        } else {
            setButtonNormal(travelBtn);
        }

        updateStatusBadge(travelBtn, evaluation);
    }

    function scanPage() {
        const buttons = document.querySelectorAll('button, a, input[type="submit"], [role="button"]');
        for (const btn of buttons) {
            if (btn.dataset.ocOrigSaved === 'true') {
                syncTravelButton(btn);
                continue;
            }
            const label = (btn.textContent || btn.value || '').trim();
            if (/^travel$/i.test(label) || /^⚠️ WARNING: OC CONFLICT$/i.test(label)) {
                syncTravelButton(btn);
            }
        }
    }

    const observer = new MutationObserver(() => {
        scanPage();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    scanPage();
})();
