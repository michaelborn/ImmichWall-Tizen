(function () {
    'use strict';

    var State = window.ImmichWallState;
    var layers = [
        { wrapper: document.querySelectorAll('.photo-layer')[0], image: document.getElementById('photo-a') },
        { wrapper: document.querySelectorAll('.photo-layer')[1], image: document.getElementById('photo-b') }
    ];
    var elements = {
        body: document.body,
        empty: document.getElementById('empty-state'),
        emptyMessage: document.getElementById('empty-message'),
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

    var settings = loadSettings();
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
    var focusBeforeSettings = null;

    function loadSettings() {
        return State.loadSettings(localStorage);
    }

    function saveSettings() {
        localStorage.setItem(State.SETTINGS_KEY, JSON.stringify(settings));
    }

    function sourceKey(source, albumId) {
        return State.sourceKey(source, albumId);
    }

    function api(path) {
        return fetch(path, { cache: 'no-store' }).then(function (response) {
            var contentType = response.headers.get('content-type') || '';
            if (contentType.indexOf('application/json') === -1) {
                if (!response.ok) throw new Error('Local server returned HTTP ' + response.status + '.');
                return response.blob();
            }
            return response.json().then(function (body) {
                if (!response.ok) throw new Error(body.error || ('Request failed with HTTP ' + response.status + '.'));
                return body;
            });
        });
    }

    function setConnection(state, label) {
        elements.connectionDot.className = 'connection-dot ' + state;
        elements.settingsDot.className = 'connection-dot ' + state;
        elements.connectionLabel.textContent = label;
        elements.settingsConnection.textContent = label;
        connected = state === 'online';
    }

    function showToast(message, duration) {
        elements.toast.textContent = message;
        elements.toast.classList.add('visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
            elements.toast.classList.remove('visible');
        }, duration || 2600);
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

    function scheduleNext(delay) {
        clearTimer();
        if (paused) return;
        timer = window.setTimeout(function () {
            loadNext(true);
        }, delay === undefined ? Number(settings.interval) * 60000 : delay);
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
            updatePhotoInfo(entry);
            updatePosition();
            if (elements.photoInfo.classList.contains('visible')) revealChrome();
        };
        target.image.onerror = function () {
            target.image.onerror = null;
            showToast('The downloaded image could not be decoded.', 3600);
        };
        target.image.onload = activate;
        if (target.image.getAttribute('src') === entry.objectUrl && target.image.complete && target.image.naturalWidth > 0) {
            activate();
            return;
        }
        target.image.src = entry.objectUrl;
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
            var params = new URLSearchParams({ source: settings.source });
            if (settings.source === 'album') params.set('albumId', settings.albumId);
            var activeSourceKey = sourceKey(settings.source, settings.albumId);
            if (historyIndex >= 0 && historySourceKey === activeSourceKey) {
                params.set('exclude', history[historyIndex].id);
            }
            var asset = await api('/api/photos/random?' + params.toString());
            var blob = await api('/api/photos/' + encodeURIComponent(asset.id) + '/thumbnail');
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
                width: asset.width,
                height: asset.height,
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
            if (!paused) scheduleNext();
        } catch (error) {
            setConnection('offline', 'Immich unavailable');
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

    function syncSettingsForm() {
        elements.source.value = settings.source;
        elements.interval.value = String(settings.interval);
        elements.album.value = settings.albumId;
        Array.prototype.forEach.call(document.querySelectorAll('input[name="fit"]'), function (radio) {
            radio.checked = radio.value === settings.fit;
        });
        updateSourceFields();
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

    function trapSettingsTab(event) {
        var focusable = Array.prototype.filter.call(
            elements.settingsPanel.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]'),
            function (element) {
                return !element.closest('[hidden]') && element.getClientRects().length > 0;
            },
        );
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

    function applySettings(nextSettings, message) {
        var sourceChanged = sourceKey(settings.source, settings.albumId) !==
            sourceKey(nextSettings.source, nextSettings.albumId);
        settings = nextSettings;
        saveSettings();
        document.body.classList.toggle('fit-contain', settings.fit === 'contain');
        closeSettings();
        if (sourceChanged) {
            loadNext(false);
        } else if (!paused) {
            scheduleNext();
        }
        if (message) showToast(message);
    }

    async function loadAlbums() {
        try {
            albums = await api('/api/albums');
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
            var status = await api('/api/status');
            elements.version.textContent = 'Immich ' + status.version;
            elements.settingsConnection.textContent = 'Connected · Immich ' + status.version;
            setConnection('online', 'Connected');
            if (showResult) showToast('Connection successful · Immich ' + status.version);
            return true;
        } catch (error) {
            elements.settingsConnection.textContent = error.message;
            setConnection('offline', 'Immich unavailable');
            if (showResult) showToast(error.message, 4200);
            return false;
        }
    }

    async function boot() {
        try {
            var config = await api('/api/config');
            elements.settingsServer.textContent = config.serverUrl || 'Server URL is not configured';
            if (!config.configured) throw new Error('Set IMMICH_SERVER_URL and IMMICH_API_KEY in the root .env file, then restart the app.');
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
        } catch (error) {
            elements.emptyMessage.textContent = error.message || 'Unable to start Immich Wall.';
            setConnection('offline', 'Not connected');
            elements.settingsConnection.textContent = error.message || 'Not connected';
        }
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
    elements.previous.addEventListener('click', goPrevious);
    elements.next.addEventListener('click', function () { loadNext(false); });
    elements.pause.addEventListener('click', function () { setPaused(!paused); });
    document.getElementById('open-settings').addEventListener('click', openSettings);
    document.getElementById('close-settings').addEventListener('click', closeSettings);
    elements.settingsScrim.addEventListener('click', closeSettings);
    document.getElementById('retry').addEventListener('click', function () { loadNext(false); });
    document.getElementById('empty-retry').addEventListener('click', function () { checkConnection(false).then(function (online) { if (online) loadNext(false); }); });
    document.getElementById('test-connection').addEventListener('click', function () { checkConnection(true); });
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
            showToast('Choose an album first.', 3200);
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
        if (event.key === 'Escape' && elements.settingsPanel.classList.contains('open')) {
            closeSettings();
            return;
        }
        if (elements.settingsPanel.classList.contains('open')) {
            if (event.key === 'Tab') trapSettingsTab(event);
            return;
        }
        if (event.target.matches('select, input, textarea')) return;
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            loadNext(false);
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goPrevious();
        } else if (event.code === 'Space') {
            event.preventDefault();
            setPaused(!paused);
        } else if (event.key.toLowerCase() === 's') {
            openSettings();
        } else if (event.key.toLowerCase() === 'i') {
            toggleInfo();
        } else if (event.key.toLowerCase() === 'f') {
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
