(function () {
    'use strict';

    var State = window.ImmichWallState;
    var Input = window.ImmichWallInput;
    var Pair = window.ImmichTvPairing;
    var driver = window.ImmichWallConnection.create();
    var isTv = driver.kind === 'tv';

    var layers = [
        { wrapper: document.querySelectorAll('.photo-layer')[0], image: document.getElementById('photo-a') },
        { wrapper: document.querySelectorAll('.photo-layer')[1], image: document.getElementById('photo-b') }
    ];
    var elements = {
        body: document.body,
        empty: document.getElementById('empty-state'),
        emptyMessage: document.getElementById('empty-message'),
        connectForm: document.getElementById('connect-form'),
        connectServer: document.getElementById('connect-server'),
        connectApiKey: document.getElementById('connect-api-key'),
        connectSubmit: document.getElementById('connect-submit'),
        emptyRetry: document.getElementById('empty-retry'),
        connectionDot: document.getElementById('connection-dot'),
        connectionLabel: document.getElementById('connection-label'),
        version: document.getElementById('server-version'),
        warning: document.getElementById('warning'),
        warningMessage: document.getElementById('warning-message'),
        position: document.getElementById('position'),
        previous: document.getElementById('previous'),
        pause: document.getElementById('pause'),
        next: document.getElementById('next'),
        info: document.getElementById('info'),
        photoInfo: document.getElementById('photo-info'),
        photoName: document.getElementById('photo-name'),
        photoDate: document.getElementById('photo-date'),
        toast: document.getElementById('toast'),
        pairView: document.getElementById('pair-view'),
        pairPin: document.getElementById('pair-pin'),
        pairExpiry: document.getElementById('pair-expiry'),
        unpairTv: document.getElementById('unpair-tv'),
        settingsPanel: document.getElementById('settings-panel'),
        settingsScrim: document.getElementById('settings-scrim'),
        source: document.getElementById('source'),
        albumField: document.getElementById('album-field'),
        album: document.getElementById('album'),
        interval: document.getElementById('interval'),
        settingsServer: document.getElementById('settings-server'),
        settingsDot: document.getElementById('settings-dot'),
        settingsConnection: document.getElementById('settings-connection')
    };

    var settings = State.loadSettings(localStorage);
    var albums = [];
    var history = [];
    var historyIndex = -1;
    var historySourceKey = '';
    var activeLayer = 0;
    var timer = null;
    var toastTimer = null;
    var chromeTimer = null;
    var retryDelay = 30000;
    var loading = false;
    var paused = false;
    var connected = false;
    var connectionActive = false;
    var focusBeforeSettings = null;
    var pairingSession = null;
    var pairingTimer = null;
    var pairingRetryTimer = null;
    var pairingPolling = false;
    var processingClaim = false;
    var processedRevision = null;
    var lastClaimAttemptAt = 0;

    document.body.classList.toggle('tv', isTv);
    Input.registerMediaKeys();

    function saveSettings() {
        localStorage.setItem(State.SETTINGS_KEY, JSON.stringify(settings));
    }

    function sourceKey(source, albumId) {
        return State.sourceKey(source, albumId);
    }

    function setConnection(state, label) {
        elements.connectionDot.className = 'connection-dot ' + state;
        elements.settingsDot.className = 'connection-dot ' + state;
        elements.connectionLabel.textContent = label;
        elements.settingsConnection.textContent = label;
        connected = state === 'online';
    }

    function showToast(message, duration, isError) {
        elements.toast.textContent = message;
        elements.toast.classList.add('visible');
        elements.toast.classList.toggle('error', Boolean(isError));
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
            elements.toast.classList.remove('visible');
        }, duration || 2600);
    }

    function setErrorState(isError) {
        elements.empty.classList.toggle('error', Boolean(isError));
    }

    function setWarning(message) {
        elements.warningMessage.textContent = message;
        elements.warning.hidden = false;
    }

    function clearWarning() {
        elements.warning.hidden = true;
    }

    function formatDate(value) {
        return State.formatDate(value);
    }

    function updatePhotoInfo(entry) {
        elements.photoName.textContent = entry.fileName || 'Immich photo';
        elements.photoDate.textContent = formatDate(entry.date);
    }

    function updatePosition() {
        if (historyIndex < 0) {
            elements.position.textContent = '—';
        } else {
            elements.position.textContent = String(historyIndex + 1).padStart(2, '0');
        }
        elements.previous.disabled = historyIndex <= 0;
    }

    function revealChrome() {
        document.body.classList.remove('chrome-hidden');
        window.clearTimeout(chromeTimer);
        if (!elements.settingsPanel.classList.contains('open')) {
            chromeTimer = window.setTimeout(function () {
                document.body.classList.add('chrome-hidden');
            }, 4200);
        }
    }

    function clearTimer() {
        if (timer) window.clearTimeout(timer);
        timer = null;
    }

    function intervalMs() {
        return Number(settings.interval) * 1000;
    }

    function scheduleNext(delay) {
        clearTimer();
        if (paused) return;
        timer = window.setTimeout(function () {
            loadNext(true);
        }, delay === undefined ? intervalMs() : delay);
    }

    function updatePauseState() {
        document.body.classList.toggle('is-paused', paused);
        elements.pause.setAttribute('aria-label', paused ? 'Resume slideshow' : 'Pause slideshow');
        elements.pause.title = paused ? 'Resume (Space)' : 'Pause (Space)';
    }

    function setPaused(value) {
        paused = value;
        updatePauseState();
        if (paused) {
            clearTimer();
            showToast('Slideshow paused');
        } else {
            scheduleNext();
            showToast('Slideshow resumed');
        }
    }

    function showEntry(entry) {
        var nextLayer = 1 - activeLayer;
        var target = layers[nextLayer];
        var activate = function () {
            target.image.onload = null;
            target.image.onerror = null;
            layers[activeLayer].wrapper.classList.remove('visible');
            target.wrapper.classList.add('visible');
            activeLayer = nextLayer;
            elements.empty.classList.add('hidden');
            elements.pairView.hidden = true;
            updatePhotoInfo(entry);
            updatePosition();
            if (elements.photoInfo.classList.contains('visible')) revealChrome();
        };
        target.image.onerror = function () {
            target.image.onerror = null;
            showToast('The downloaded image could not be decoded.', 3600, true);
        };
        target.image.onload = activate;
        if (target.image.getAttribute('src') === entry.objectUrl && target.image.complete && target.image.naturalWidth > 0) {
            activate();
            return;
        }
        target.image.src = entry.objectUrl;
    }

    function dropHistoryFrom(index) {
        for (var i = index; i < history.length; i += 1) {
            if (history[i].objectUrl) URL.revokeObjectURL(history[i].objectUrl);
        }
    }

    function appendHistory(entry) {
        var result = State.appendHistory(history, historyIndex, entry);
        result.removed.forEach(function (removed) {
            if (removed.objectUrl) URL.revokeObjectURL(removed.objectUrl);
        });
        history = result.history;
        historyIndex = result.index;
        historySourceKey = sourceKey(settings.source, settings.albumId);
        showEntry(entry);
    }

    function resetPhotos() {
        dropHistoryFrom(0);
        history = [];
        historyIndex = -1;
        historySourceKey = '';
        updatePosition();
        layers.forEach(function (layer) {
            layer.image.removeAttribute('src');
            layer.wrapper.classList.remove('visible');
        });
        layers[0].wrapper.classList.add('visible');
        activeLayer = 0;
        elements.photoInfo.classList.remove('visible');
    }

    function preload(url) {
        return new Promise(function (resolve, reject) {
            var image = new Image();
            image.onload = function () { resolve(); };
            image.onerror = function () { reject(new Error('The downloaded image could not be decoded.')); };
            image.src = url;
        });
    }

    async function loadNext(isAutomatic) {
        if (loading || (isAutomatic && paused)) return;
        if (settings.source === 'album' && !settings.albumId) {
            openSettings();
            showToast('Choose an album to start the slideshow.', 3600);
            return;
        }

        loading = true;
        elements.next.classList.add('is-loading');
        if (!history.length) elements.emptyMessage.textContent = 'Finding a photo in your Immich library…';
        try {
            var activeSourceKey = sourceKey(settings.source, settings.albumId);
            var excludeId = historyIndex >= 0 && historySourceKey === activeSourceKey ? history[historyIndex].id : '';
            var asset = await driver.randomPhoto({
                source: settings.source,
                albumId: settings.albumId,
                excludeId: excludeId,
            });
            var blob = await driver.thumbnail(asset.id);
            var objectUrl = URL.createObjectURL(blob);
            try {
                await preload(objectUrl);
            } catch (error) {
                URL.revokeObjectURL(objectUrl);
                throw error;
            }

            var entry = {
                id: asset.id,
                fileName: asset.fileName,
                date: asset.date,
                objectUrl: objectUrl
            };
            if (history.length && historySourceKey !== activeSourceKey) {
                var oldHistory = history;
                history = [];
                historyIndex = -1;
                appendHistory(entry);
                window.setTimeout(function () {
                    oldHistory.forEach(function (oldEntry) {
                        if (oldEntry.objectUrl) URL.revokeObjectURL(oldEntry.objectUrl);
                    });
                }, 1500);
            } else {
                appendHistory(entry);
            }
            retryDelay = 30000;
            clearWarning();
            setConnection('online', 'Connected');
            setErrorState(false);
            if (!paused) scheduleNext();
        } catch (error) {
            setConnection('offline', 'Immich unavailable');
            setErrorState(true);
            var message = error.message || 'Could not load a photo from Immich.';
            setWarning(history.length
                ? 'Immich unavailable; keeping the current photo on screen.'
                : message);
            if (!history.length) elements.emptyMessage.textContent = message;
            if (!paused) {
                scheduleNext(retryDelay);
                retryDelay = State.nextRetryDelay(retryDelay);
            }
        } finally {
            loading = false;
            elements.next.classList.remove('is-loading');
        }
    }

    function goPrevious() {
        if (historyIndex <= 0) return;
        historyIndex = State.previousIndex(historyIndex);
        showEntry(history[historyIndex]);
        if (!paused) scheduleNext();
    }

    function updateSourceFields() {
        elements.albumField.hidden = elements.source.value !== 'album';
    }

    function syncChoiceCards() {
        Array.prototype.forEach.call(document.querySelectorAll('.choice-card input[name="fit"]'), function (radio) {
            var card = radio.closest('.choice-card');
            if (card) card.classList.toggle('selected', radio.checked);
        });
    }

    elements.settingsPanel.addEventListener('focusin', function (event) {
        var card = event.target && event.target.closest ? event.target.closest('.choice-card') : null;
        Array.prototype.forEach.call(document.querySelectorAll('.choice-card'), function (element) {
            element.classList.toggle('focused', element === card);
        });
    });

    elements.settingsPanel.addEventListener('focusout', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.choice-card'), function (element) {
            element.classList.remove('focused');
        });
    });

    function syncSettingsForm() {
        elements.source.value = settings.source;
        elements.interval.value = String(settings.interval);
        elements.album.value = settings.albumId;
        Array.prototype.forEach.call(document.querySelectorAll('input[name="fit"]'), function (radio) {
            radio.checked = radio.value === settings.fit;
        });
        updateSourceFields();
        syncChoiceCards();
    }

    function openSettings() {
        focusBeforeSettings = document.activeElement;
        syncSettingsForm();
        elements.settingsPanel.classList.add('open');
        elements.settingsPanel.setAttribute('aria-hidden', 'false');
        elements.settingsScrim.classList.add('open');
        elements.source.focus();
        revealChrome();
    }

    function closeSettings() {
        elements.settingsPanel.classList.remove('open');
        elements.settingsPanel.setAttribute('aria-hidden', 'true');
        elements.settingsScrim.classList.remove('open');
        revealChrome();
        if (focusBeforeSettings && typeof focusBeforeSettings.focus === 'function') {
            focusBeforeSettings.focus();
        }
        focusBeforeSettings = null;
    }

    function drawerControls() {
        return Array.prototype.filter.call(
            elements.settingsPanel.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled])'),
            function (element) {
                return !element.closest('[hidden]') && element.getClientRects().length > 0;
            },
        );
    }

    function trapSettingsTab(event) {
        var focusable = drawerControls();
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !elements.settingsPanel.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !elements.settingsPanel.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    }

    function cycleDrawerFocus(event) {
        var focusable = drawerControls();
        if (!focusable.length) return;
        var index = focusable.indexOf(document.activeElement);
        var direction = event.keyCode === 40 ? 1 : -1;
        var next = (index + direction + focusable.length) % focusable.length;
        event.preventDefault();
        focusable[next].focus();
    }

    function applySettings(nextSettings, message) {
        var sourceChanged = sourceKey(settings.source, settings.albumId) !==
            sourceKey(nextSettings.source, nextSettings.albumId);
        settings = nextSettings;
        saveSettings();
        document.body.classList.toggle('fit-contain', settings.fit === 'contain');
        closeSettings();
        if (sourceChanged) {
            resetPhotos();
            loadNext(false);
        } else if (!paused) {
            scheduleNext();
        }
        if (message) showToast(message);
    }

    async function loadAlbums() {
        try {
            albums = await driver.albums();
            var selected = elements.album.value;
            elements.album.innerHTML = '';
            if (!albums.length) {
                elements.album.add(new Option('No albums with photos', ''));
                return;
            }
            albums.forEach(function (album) {
                elements.album.add(new Option(album.name + ' · ' + album.assetCount, album.id));
            });
            if (albums.some(function (album) { return album.id === selected; })) {
                elements.album.value = selected;
            } else if (albums.length) {
                elements.album.value = albums[0].id;
            }
        } catch (error) {
            elements.album.innerHTML = '';
            elements.album.add(new Option('Could not load albums', ''));
        }
    }

    async function checkConnection(showResult) {
        setConnection('', 'Checking connection…');
        elements.settingsConnection.textContent = 'Checking connection…';
        try {
            var status = await driver.status();
            elements.version.textContent = status.version ? 'Immich ' + status.version : '';
            elements.settingsConnection.textContent = status.version ? 'Connected · Immich ' + status.version : 'Connected to Immich';
            setConnection('online', 'Connected');
            if (showResult) showToast(status.version ? 'Connection successful · Immich ' + status.version : 'Connection successful');
            return true;
        } catch (error) {
            elements.settingsConnection.textContent = error.message;
            setConnection('offline', 'Immich unavailable');
            if (showResult) showToast(error.message, 4200, true);
            return false;
        }
    }

    async function enterSlideshow(serverUrlText) {
        connectionActive = true;
        document.body.classList.remove('pairing');
        resetPhotos();
        elements.settingsServer.textContent = serverUrlText || 'Immich connection ready';
        elements.pairView.hidden = true;
        elements.empty.classList.add('connected');
        elements.pairView.hidden = true;
        elements.emptyRetry.hidden = false;
        var online = await checkConnection(false);
        await loadAlbums();
        syncSettingsForm();
        if (online) {
            await loadNext(false);
        } else {
            setWarning('Immich is unavailable. The app will retry automatically.');
            elements.emptyMessage.textContent = 'Immich is unavailable. Check the connection and retry.';
            scheduleNext(retryDelay);
        }
    }

    async function boot() {
        try {
            var initial = await driver.init();
            if (initial.configured) {
                await enterSlideshow(initial.serverUrl);
                return;
            }
            if (isTv) {
                showPairingView();
                beginPairing();
            } else {
                elements.empty.classList.remove('connected', 'hidden');
                elements.emptyMessage.textContent = 'Connect to your Immich server to begin.';
                elements.emptyRetry.hidden = true;
                setConnection('offline', 'Not connected');
                elements.connectApiKey.focus();
            }
        } catch (error) {
            if (isTv) {
                showPairingView();
                beginPairing();
            } else {
                elements.empty.classList.remove('connected', 'hidden');
                elements.emptyMessage.textContent = error.message || 'Unable to start Immich Wall.';
                elements.emptyRetry.hidden = true;
                setErrorState(true);
                setConnection('offline', 'Not connected');
                elements.settingsConnection.textContent = error.message || 'Not connected';
            }
        }
    }

    async function connectFromForm(event) {
        event.preventDefault();
        if (loading) return;
        elements.connectSubmit.disabled = true;
        elements.connectSubmit.textContent = 'Connecting…';
        elements.emptyMessage.textContent = 'Checking your Immich connection…';
        setErrorState(false);
        setConnection('', 'Connecting…');
        try {
            var connection = await driver.connect({
                serverUrl: elements.connectServer.value.trim(),
                apiKey: elements.connectApiKey.value,
            });
            elements.connectApiKey.value = '';
            await enterSlideshow(connection.serverUrl);
        } catch (error) {
            connectionActive = false;
            resetPhotos();
            elements.empty.classList.remove('connected');
            elements.emptyMessage.textContent = error.message || 'Unable to connect to Immich.';
            elements.emptyRetry.hidden = true;
            setConnection('offline', 'Connection failed');
            setErrorState(true);
            showToast(error.message || 'Unable to connect to Immich.', 4200, true);
            elements.connectApiKey.focus();
        } finally {
            elements.connectSubmit.disabled = false;
            elements.connectSubmit.textContent = 'Connect & start';
        }
    }

    async function changeConnection() {
        closeSettings();
        clearTimer();
        try {
            await driver.disconnect();
        } catch (error) {
            // Still show setup so a user can recover from a stale connection.
        }
        connectionActive = false;
        resetPhotos();
        elements.empty.classList.remove('connected', 'hidden');
        elements.emptyMessage.textContent = 'Enter your Immich connection details.';
        var previousUrl = elements.settingsServer.textContent;
        elements.connectServer.value = /^https?:\/\//i.test(previousUrl) ? previousUrl : 'https://immich.theborns.xyz';
        elements.connectApiKey.value = '';
        elements.emptyRetry.hidden = true;
        setConnection('offline', 'Not connected');
        setErrorState(false);
        elements.connectApiKey.focus();
    }

    // TV pairing

    function showPairingView() {
        elements.pairView.hidden = false;
        elements.empty.classList.add('hidden');
        document.body.classList.add('pairing');
        document.body.classList.remove('is-paused');
    }

    function stopPairing() {
        if (pairingTimer) window.clearInterval(pairingTimer);
        pairingTimer = null;
        if (pairingRetryTimer) window.clearTimeout(pairingRetryTimer);
        pairingRetryTimer = null;
        pairingSession = null;
    }

    function schedulePairingRetry() {
        if (pairingRetryTimer) return;
        pairingRetryTimer = window.setTimeout(function () {
            pairingRetryTimer = null;
            beginPairing();
        }, 5000);
    }

    function beginPairing() {
        stopPairing();
        processedRevision = null;
        elements.pairPin.textContent = 'Starting…';
        elements.pairExpiry.textContent = 'The PIN refreshes automatically when it expires.';
        Pair.request('sessions', 'POST', {}).then(function (session) {
            pairingSession = session;
            elements.pairPin.textContent = session.pin;
            pollPairing();
            pairingTimer = window.setInterval(pollPairing, 2000);
        }).catch(function (error) {
            elements.pairPin.textContent = '…';
            elements.pairExpiry.textContent = 'Reaching the pairing service is taking a while. Retrying.';
            showToast(error.message || 'Cannot reach the pairing service yet. Retrying.', 4200, true);
            schedulePairingRetry();
        });
    }

    async function handleClaimedSession(data) {
        if (processingClaim) return;
        if (data.revision === processedRevision && Date.now() - lastClaimAttemptAt < 5000) return;
        processingClaim = true;
        lastClaimAttemptAt = Date.now();
        var claim = { serverUrl: data.serverUrl, apiKey: data.apiKey };
        showToast('Validating the connection and storing it securely…');
        try {
            await driver.probe(claim);
            await driver.save(claim);
            await Pair.request('acknowledge', 'POST', {
                sessionId: pairingSession.sessionId,
                revision: data.revision,
            });
            processedRevision = data.revision;
            await enterSlideshow(claim.serverUrl);
            showToast('Paired. Your TV is connected to Immich.');
        } catch (error) {
            if (error.status === 409) {
                processedRevision = null;
                showToast('The phone updated the connection. Checking again…');
            } else {
                processedRevision = data.revision;
                var message = error.message || 'Could not validate or store this connection.';
                showToast(message, 5000, true);
                Pair.request('session-error', 'POST', {
                    sessionId: pairingSession.sessionId,
                    revision: data.revision,
                    message: message,
                }).catch(function () { });
            }
        } finally {
            processingClaim = false;
        }
    }

    function pollPairing() {
        if (!pairingSession || pairingPolling || processingClaim || connectionActive) return;
        pairingPolling = true;
        Pair.request('sessions/' + encodeURIComponent(pairingSession.sessionId), 'GET').then(function (result) {
            if (result.state === 'claimed') {
                return handleClaimedSession(result);
            }
            if (result.state === 'expired') {
                stopPairing();
                showToast('This PIN expired. Getting a new one…');
                beginPairing();
            }
        }).catch(function (error) {
            showToast(error.message || 'Cannot check the pairing session.', 5000, true);
        }).then(function () {
            pairingPolling = false;
        });
    }

    async function unpairTv() {
        closeSettings();
        clearTimer();
        try {
            await driver.disconnect();
        } catch (error) {
            showToast(error.message || 'Could not unpair this TV.', 4200, true);
            return;
        }
        connectionActive = false;
        paused = false;
        updatePauseState();
        clearWarning();
        resetPhotos();
        showPairingView();
        showToast('TV connection removed. Pair again to reconnect.');
        beginPairing();
    }

    function toggleInfo() {
        if (historyIndex < 0) return;
        elements.photoInfo.classList.toggle('visible');
        revealChrome();
    }

    async function toggleFullscreen() {
        try {
            if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
            else await document.exitFullscreen();
        } catch (error) {
            showToast('Fullscreen is unavailable in this browser.');
        }
    }

    elements.source.addEventListener('change', updateSourceFields);
    Array.prototype.forEach.call(document.querySelectorAll('.choice-card input[name="fit"]'), function (radio) {
        radio.addEventListener('change', syncChoiceCards);
    });
    elements.connectForm.addEventListener('submit', connectFromForm);
    elements.previous.addEventListener('click', goPrevious);
    elements.pause.addEventListener('click', function () { setPaused(!paused); });
    elements.next.addEventListener('click', function () { loadNext(false); });
    document.getElementById('open-settings').addEventListener('click', openSettings);
    document.getElementById('close-settings').addEventListener('click', closeSettings);
    elements.settingsScrim.addEventListener('click', closeSettings);
    document.getElementById('retry').addEventListener('click', function () { loadNext(false); });
    document.getElementById('empty-retry').addEventListener('click', function () { checkConnection(false).then(function (online) { if (online) loadNext(false); }); });
    document.getElementById('test-connection').addEventListener('click', function () { checkConnection(true); });
    document.getElementById('change-connection').addEventListener('click', changeConnection);
    elements.unpairTv.addEventListener('click', unpairTv);
    elements.info.addEventListener('click', toggleInfo);
    document.getElementById('fullscreen').addEventListener('click', toggleFullscreen);

    document.getElementById('save-settings').addEventListener('click', function () {
        var nextSettings = {
            source: elements.source.value,
            albumId: elements.source.value === 'album' ? elements.album.value : '',
            interval: Number(elements.interval.value),
            fit: document.querySelector('input[name="fit"]:checked').value
        };
        if (nextSettings.source === 'album' && !nextSettings.albumId) {
            showToast('Choose an album first.', 3200, true);
            return;
        }
        applySettings(nextSettings, 'Slideshow settings applied.');
    });

    document.getElementById('reset-settings').addEventListener('click', function () {
        var defaults = Object.assign({}, State.DEFAULT_SETTINGS);
        applySettings(defaults, 'Preferences reset.');
        syncSettingsForm();
    });

    document.addEventListener('keydown', function (event) {
        if (!elements.pairView.hidden) return;
        var drawerOpen = elements.settingsPanel.classList.contains('open');
        if (event.key === 'Tab') {
            if (drawerOpen) trapSettingsTab(event);
            return;
        }
        var action = Input.actionFor(event, isTv);
        if (!action) return;
        if (drawerOpen) {
            if (isTv && action === 'open-settings') {
                cycleDrawerFocus(event);
                return;
            }
            if (action === 'back') {
                event.preventDefault();
                closeSettings();
            }
            return;
        }
        if (event.target && event.target.matches && event.target.matches('select, input, textarea')) return;
        if (action === 'next') {
            event.preventDefault();
            loadNext(false);
        } else if (action === 'previous') {
            event.preventDefault();
            goPrevious();
        } else if (action === 'toggle-pause' || action === 'pause' || action === 'play') {
            event.preventDefault();
            if (action === 'toggle-pause') setPaused(!paused);
            else if (action === 'pause') setPaused(true);
            else setPaused(false);
        } else if (action === 'open-settings') {
            openSettings();
        } else if (action === 'details') {
            toggleInfo();
        } else if (action === 'fullscreen') {
            toggleFullscreen();
        }
        revealChrome();
    });

    document.addEventListener('pointermove', revealChrome, { passive: true });
    document.addEventListener('pointerdown', revealChrome, { passive: true });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) clearTimer();
        else if (!paused && history.length) scheduleNext();
    });

    document.body.classList.toggle('fit-contain', settings.fit === 'contain');
    syncSettingsForm();
    revealChrome();
    boot();
}());
