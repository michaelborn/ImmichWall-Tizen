(function () {
    'use strict';

    var form = document.getElementById('pair-form');
    var stepPin = document.getElementById('step-pin');
    var stepDetails = document.getElementById('step-details');
    var stepLabel = document.getElementById('step-label');
    var intro = document.getElementById('intro');
    var pinField = document.getElementById('pin');
    var verifyButton = document.getElementById('verify-button');
    var urlField = document.getElementById('server-url');
    var keyField = document.getElementById('api-key');
    var submitButton = document.getElementById('submit-button');
    var startOverButton = document.getElementById('start-over');
    var status = document.getElementById('status');
    var storageKey = 'immich-wall-pair-handoff';
    var handoffToken = sessionStorage.getItem(storageKey) || '';
    var pollTimer = null;
    var step = 'pin';
    var verifiedPin = '';

    function show(message, isError) {
        status.textContent = message;
        status.className = isError ? 'error' : '';
    }

    function clearStatus() {
        show('', false);
    }

    function showStep(name) {
        step = name;
        stepPin.classList.toggle('hidden', name !== 'pin');
        stepDetails.classList.toggle('hidden', name !== 'details');
        startOverButton.classList.toggle('hidden', name === 'pin' && !handoffToken);
        if (name === 'pin') {
            stepLabel.textContent = 'Step 1 of 2 · Verify the PIN';
            intro.textContent = 'Enter the five-digit PIN shown on your TV.';
        } else {
            stepLabel.textContent = 'Step 2 of 2 · Immich connection';
            intro.textContent = handoffToken
                ? 'The TV is checking this connection. You can update it until pairing completes.'
                : 'The PIN is verified. Add your Immich server URL and API key.';
        }
    }

    function stopPolling() {
        if (pollTimer) window.clearInterval(pollTimer);
        pollTimer = null;
    }

    function post(path, body) {
        return fetch('/api/pairing/' + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify(body)
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                if (!response.ok) throw new Error(data.error || 'Pairing request failed.');
                return data;
            });
        });
    }

    function complete() {
        stopPolling();
        handoffToken = '';
        verifiedPin = '';
        sessionStorage.removeItem(storageKey);
        keyField.value = '';
        stepLabel.textContent = 'Pairing complete';
        intro.textContent = 'Your TV is connected to Immich.';
        stepDetails.classList.add('hidden');
        stepPin.classList.add('hidden');
        startOverButton.classList.add('hidden');
        step = 'done';
        show('Pairing complete. You can close this page.', false);
    }

    function showHandoffError(message) {
        show('The TV reported: ' + message, true);
    }

    function checkStatus() {
        if (!handoffToken) return;
        post('handoff-status', { handoffToken: handoffToken }).then(function (result) {
            if (result.state === 'acknowledged') complete();
            else if (result.state === 'error') showHandoffError(result.message);
            else if (status.classList.contains('error')) show('Waiting for the TV to validate and save the connection…', false);
        }).catch(function (error) {
            if (error.message.indexOf('expired') !== -1 || error.message.indexOf('invalid') !== -1) {
                stopPolling();
                handoffToken = '';
                sessionStorage.removeItem(storageKey);
                pinField.value = '';
                showStep('pin');
                show('This pairing handoff has expired. Start again from the PIN on your TV.', true);
            }
        });
    }

    function waitingForTv() {
        showStep('details');
        submitButton.textContent = 'Update connection';
        show('Waiting for the TV to validate and save the connection…', false);
        if (!pollTimer) pollTimer = window.setInterval(checkStatus, 2500);
        checkStatus();
    }

    pinField.addEventListener('input', function () {
        var digits = pinField.value.replace(/\D+/g, '').slice(0, 5);
        if (digits !== pinField.value) pinField.value = digits;
    });

    function verifyPin() {
        verifyButton.disabled = true;
        show('Checking the PIN…', false);
        post('verify-pin', { pin: pinField.value }).then(function () {
            verifiedPin = pinField.value;
            pinField.value = '';
            showStep('details');
            clearStatus();
            urlField.focus();
            urlField.select();
        }).catch(function (error) {
            show(error.message, true);
        }).finally(function () {
            verifyButton.disabled = false;
        });
    }

    function submitConnection() {
        submitButton.disabled = true;
        show(handoffToken ? 'Updating connection…' : 'Checking your Immich connection…', false);
        var details = { serverUrl: urlField.value, apiKey: keyField.value };
        var operation = handoffToken
            ? post('update', Object.assign({ handoffToken: handoffToken }, details))
            : post('claim', Object.assign({ pin: verifiedPin }, details));

        operation.then(function (result) {
            if (result.handoffToken) {
                handoffToken = result.handoffToken;
                sessionStorage.setItem(storageKey, handoffToken);
                waitingForTv();
            } else {
                show('Connection updated. The TV will retry it automatically.', false);
            }
        }).catch(function (error) {
            if (!handoffToken) {
                verifiedPin = '';
                pinField.value = '';
                showStep('pin');
            }
            show(error.message, true);
        }).finally(function () {
            submitButton.disabled = false;
        });
    }

    startOverButton.addEventListener('click', function () {
        stopPolling();
        handoffToken = '';
        verifiedPin = '';
        sessionStorage.removeItem(storageKey);
        keyField.value = '';
        pinField.value = '';
        submitButton.textContent = 'Connect TV';
        showStep('pin');
        clearStatus();
        pinField.focus();
    });

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (step === 'done') return;
        if (step === 'pin') verifyPin();
        else submitConnection();
    });

    if (handoffToken) waitingForTv();
    else showStep('pin');
}());
