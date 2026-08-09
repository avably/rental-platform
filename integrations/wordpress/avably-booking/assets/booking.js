/**
 * Avably Booking — skrypt frontowy flow rezerwacji.
 *
 * ZASADY BEZPIECZEŃSTWA:
 *  - rozmawia WYŁĄCZNIE z admin-ajax.php tej instalacji (ajaxUrl + nonce
 *    z wp_localize_script) — żadnych wywołań do API Avably z przeglądarki,
 *  - klucz API nie istnieje w tym pliku ani w payloadzie avablyBooking,
 *  - wszystkie dane z odpowiedzi trafiają do DOM przez textContent
 *    (nigdy innerHTML) — treść z API jest danymi, nie znacznikami.
 */
(function () {
	'use strict';

	var config = window.avablyBooking;
	if (!config || !config.ajaxUrl) {
		return;
	}

	var root = document.querySelector('[data-avably-product]');
	if (!root) {
		return;
	}
	var productId = root.getAttribute('data-avably-product');
	var i18n = config.i18n || {};

	var calendarEl = root.querySelector('[data-avably-calendar]');
	var form = root.querySelector('[data-avably-form]');
	var notice = root.querySelector('[data-avably-notice]');
	var availabilityEl = root.querySelector('[data-avably-availability]');
	var confirmationEl = root.querySelector('[data-avably-confirmation]');
	var startInput = root.querySelector('input[name="start_date"]');
	var endInput = root.querySelector('input[name="end_date"]');
	var deliverySelect = root.querySelector('select[name="delivery_method"]');
	var pickupRow = root.querySelector('[data-avably-pickup-row]');

	var today = new Date();
	var viewYear = today.getFullYear();
	var viewMonth = today.getMonth(); // 0-11

	function pad(n) {
		return n < 10 ? '0' + n : String(n);
	}

	function isoToday() {
		return today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
	}

	function ajax(action, params, method, done) {
		var url = new URL(config.ajaxUrl, window.location.origin);
		var body = null;
		if (method === 'GET') {
			url.searchParams.set('action', action);
			url.searchParams.set('nonce', config.nonce);
			Object.keys(params).forEach(function (key) {
				url.searchParams.set(key, params[key]);
			});
		} else {
			body = new URLSearchParams();
			body.set('action', action);
			body.set('nonce', config.nonce);
			Object.keys(params).forEach(function (key) {
				body.set(key, params[key]);
			});
		}
		fetch(url.toString(), {
			method: method,
			credentials: 'same-origin',
			body: body
		})
			.then(function (response) {
				return response.json().then(function (json) {
					done(null, json);
				});
			})
			.catch(function () {
				done(new Error('network'), null);
			});
	}

	function showNotice(message, isError) {
		if (!notice) {
			return;
		}
		notice.hidden = false;
		notice.textContent = message;
		notice.className = 'avably-booking__notice' + (isError ? ' avably-booking__notice--error' : '');
	}

	function clearNotice() {
		if (notice) {
			notice.hidden = true;
			notice.textContent = '';
		}
	}

	function clearFieldErrors() {
		root.querySelectorAll('[data-avably-error-for]').forEach(function (el) {
			el.hidden = true;
			el.textContent = '';
		});
	}

	function showFieldErrors(fields) {
		Object.keys(fields || {}).forEach(function (fieldKey) {
			var input = root.querySelector('[data-avably-field="' + fieldKey + '"]');
			if (!input) {
				return;
			}
			var row = input.closest('.avably-booking__field') || input.closest('p');
			var slot = row ? row.querySelector('[data-avably-error-for]') : null;
			if (slot) {
				slot.hidden = false;
				slot.textContent = fields[fieldKey];
			}
		});
	}

	// ------------------------------------------------------------------
	// Kalendarz miesięczny (dane ZAWSZE z endpointu ajaxowego).
	// ------------------------------------------------------------------

	function renderCalendarShell() {
		while (calendarEl.firstChild) {
			calendarEl.removeChild(calendarEl.firstChild);
		}

		var header = document.createElement('div');
		header.className = 'avably-cal__header';

		var prev = document.createElement('button');
		prev.type = 'button';
		prev.className = 'avably-cal__nav';
		prev.textContent = '‹';
		prev.addEventListener('click', function () {
			viewMonth -= 1;
			if (viewMonth < 0) {
				viewMonth = 11;
				viewYear -= 1;
			}
			loadMonth();
		});

		var next = document.createElement('button');
		next.type = 'button';
		next.className = 'avably-cal__nav';
		next.textContent = '›';
		next.addEventListener('click', function () {
			viewMonth += 1;
			if (viewMonth > 11) {
				viewMonth = 0;
				viewYear += 1;
			}
			loadMonth();
		});

		var title = document.createElement('span');
		title.className = 'avably-cal__title';
		title.textContent = (i18n.monthNames || [])[viewMonth] + ' ' + viewYear;

		header.appendChild(prev);
		header.appendChild(title);
		header.appendChild(next);
		calendarEl.appendChild(header);

		var grid = document.createElement('div');
		grid.className = 'avably-cal__grid';
		(i18n.dayNames || []).forEach(function (day) {
			var cell = document.createElement('span');
			cell.className = 'avably-cal__dow';
			cell.textContent = day;
			grid.appendChild(cell);
		});
		calendarEl.appendChild(grid);

		var status = document.createElement('p');
		status.className = 'avably-cal__status';
		status.textContent = i18n.checking || '';
		calendarEl.appendChild(status);

		return { grid: grid, status: status };
	}

	function loadMonth(attempt) {
		var shell = renderCalendarShell();
		var monthStr = viewYear + '-' + pad(viewMonth + 1);
		ajax('avably_booking_month', { product_id: productId, month: monthStr }, 'GET', function (err, json) {
			if (err || !json || !json.success) {
				// `busy`: serwer właśnie rozstrzyga ten miesiąc dla innego
				// żądania (wpis-blokada) — wynik za chwilę będzie w cache'u.
				// Ponawiamy cicho, zamiast pokazywać drugiemu odwiedzającemu
				// komunikat błędu, na który nic nie poradzi.
				var code = json && json.data && json.data.code;
				if (code === 'busy' && (attempt || 0) < 2) {
					shell.status.textContent = i18n.checking || '';
					window.setTimeout(function () {
						loadMonth((attempt || 0) + 1);
					}, 1800);
					return;
				}
				shell.status.textContent = (json && json.data && json.data.message) || i18n.genericError || '';
				return;
			}
			// Wynik CZĘŚCIOWY: część dni nie dostała odpowiedzi z API (budżet
			// czasu). Takie dni nie są „zajęte" — pokazujemy je neutralnie
			// i mówimy wprost, że dostępność jest jeszcze sprawdzana.
			var unresolved = json.data.unresolved || [];
			shell.status.textContent = unresolved.length ? (i18n.checking || '') : '';
			paintMonth(shell.grid, json.data.days || {}, unresolved);
		});
	}

	function paintMonth(grid, days, unresolved) {
		var pending = {};
		(unresolved || []).forEach(function (iso) {
			pending[iso] = true;
		});
		var first = new Date(viewYear, viewMonth, 1);
		var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		var offset = (first.getDay() + 6) % 7; // Poniedziałek pierwszy.

		for (var i = 0; i < offset; i++) {
			var filler = document.createElement('span');
			filler.className = 'avably-cal__day avably-cal__day--empty';
			grid.appendChild(filler);
		}

		var todayIso = isoToday();
		for (var day = 1; day <= daysInMonth; day++) {
			var iso = viewYear + '-' + pad(viewMonth + 1) + '-' + pad(day);
			var cell = document.createElement('button');
			cell.type = 'button';
			cell.className = 'avably-cal__day';
			cell.textContent = String(day);
			if (iso < todayIso) {
				cell.disabled = true;
				cell.classList.add('avably-cal__day--past');
			} else if (pending[iso]) {
				// Nieznane ≠ zajęte. Dzień nie jest klikalny (nie wiemy, czy
				// jest wolny), ale nie udaje wyniku — wygląd neutralny.
				cell.disabled = true;
				cell.classList.add('avably-cal__day--unknown');
				cell.title = i18n.checking || '';
			} else if (!(iso in days)) {
				cell.disabled = true;
				cell.classList.add('avably-cal__day--past');
			} else if (days[iso] > 0) {
				cell.classList.add('avably-cal__day--free');
				cell.title = days[iso] + ' ' + (i18n.unitsLeft || '');
				cell.setAttribute('data-avably-day', iso);
			} else {
				cell.disabled = true;
				cell.classList.add('avably-cal__day--taken');
			}
			cell.addEventListener('click', onDayClick);
			grid.appendChild(cell);
		}
	}

	function onDayClick(event) {
		var iso = event.currentTarget.getAttribute('data-avably-day');
		if (!iso || !startInput || !endInput) {
			return;
		}
		// Pierwszy klik = start; drugi (późniejszy) = koniec; kolejny — od nowa.
		if (!startInput.value || endInput.value || iso < startInput.value) {
			startInput.value = iso;
			endInput.value = '';
		} else {
			endInput.value = iso;
		}
		highlightSelection();
		checkRange();
	}

	function highlightSelection() {
		var start = startInput ? startInput.value : '';
		var end = endInput ? endInput.value : '';
		root.querySelectorAll('.avably-cal__day[data-avably-day]').forEach(function (cell) {
			var iso = cell.getAttribute('data-avably-day');
			var selected = (start && iso === start) || (end && iso === end) ||
				(start && end && iso > start && iso < end);
			cell.classList.toggle('avably-cal__day--selected', Boolean(selected));
		});
	}

	// ------------------------------------------------------------------
	// Dostępność wybranego zakresu.
	// ------------------------------------------------------------------

	function checkRange() {
		if (!availabilityEl || !startInput || !endInput) {
			return;
		}
		var start = startInput.value;
		var end = endInput.value;
		if (!start || !end || end < start) {
			availabilityEl.textContent = '';
			return;
		}
		availabilityEl.textContent = i18n.checking || '';
		ajax(
			'avably_booking_availability',
			{ product_id: productId, start_date: start, end_date: end },
			'GET',
			function (err, json) {
				if (err || !json || !json.success) {
					availabilityEl.textContent = (json && json.data && json.data.message) || i18n.genericError || '';
					return;
				}
				var available = json.data.available_units;
				if (available > 0) {
					availabilityEl.textContent = (i18n.rangeAvailable || '') + ' (' + available + ' ' + (i18n.unitsLeft || '') + ')';
					availabilityEl.className = 'avably-booking__availability avably-booking__availability--ok';
				} else {
					availabilityEl.textContent = i18n.rangeSoldOut || '';
					availabilityEl.className = 'avably-booking__availability avably-booking__availability--none';
				}
			}
		);
	}

	// ------------------------------------------------------------------
	// Formularz rezerwacji.
	// ------------------------------------------------------------------

	function formatMoney(grosze, currency) {
		var amount = (grosze / 100).toFixed(2).replace('.', ',');
		var symbol = currency === 'PLN' ? 'zł' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency;
		return amount + ' ' + symbol;
	}

	function renderConfirmation(order) {
		while (confirmationEl.firstChild) {
			confirmationEl.removeChild(confirmationEl.firstChild);
		}
		var title = document.createElement('h3');
		title.textContent = i18n.confirmedTitle || '';
		confirmationEl.appendChild(title);

		var list = document.createElement('dl');
		list.className = 'avably-booking__summary';

		function row(label, value) {
			var dt = document.createElement('dt');
			dt.textContent = label;
			var dd = document.createElement('dd');
			dd.textContent = value;
			list.appendChild(dt);
			list.appendChild(dd);
		}

		row(i18n.orderNumber || '', order.order_number);
		row(i18n.dates || '', order.start_date + ' → ' + order.end_date);
		row(i18n.rental || '', formatMoney(order.total_rental_grosze, order.currency));
		if (order.total_deposit_grosze > 0) {
			row(i18n.depositLabel || '', formatMoney(order.total_deposit_grosze, order.currency));
		}
		if (order.delivery_grosze > 0) {
			row(i18n.deliveryLabel || '', formatMoney(order.delivery_grosze, order.currency));
		}
		row(
			i18n.payment || '',
			order.payment_method === 'transfer' ? (i18n.paymentTransfer || '') : (i18n.paymentCod || '')
		);

		confirmationEl.appendChild(list);
		confirmationEl.hidden = false;
		form.hidden = true;
		if (calendarEl) {
			calendarEl.hidden = true;
		}
		confirmationEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function onSubmit(event) {
		event.preventDefault();
		clearNotice();
		clearFieldErrors();

		var submitButton = form.querySelector('[data-avably-submit]');
		if (submitButton) {
			submitButton.disabled = true;
		}
		showNotice(i18n.submitting || '', false);

		var data = new FormData(form);
		var params = { product_id: productId };
		data.forEach(function (value, key) {
			params[key] = String(value);
		});

		ajax('avably_booking_reserve', params, 'POST', function (err, json) {
			if (submitButton) {
				submitButton.disabled = false;
			}
			if (err || !json) {
				showNotice(i18n.genericError || '', true);
				return;
			}
			if (json.success && json.data && json.data.order) {
				clearNotice();
				renderConfirmation(json.data.order);
				return;
			}
			var payload = json.data || {};
			showNotice(payload.message || i18n.genericError || '', true);
			if (payload.fields) {
				showFieldErrors(payload.fields);
			}
		});
	}

	// ------------------------------------------------------------------
	// Start.
	// ------------------------------------------------------------------

	if (deliverySelect && pickupRow) {
		deliverySelect.addEventListener('change', function () {
			pickupRow.hidden = deliverySelect.value !== 'pickup';
		});
	}
	if (startInput && endInput) {
		var todayIso = isoToday();
		startInput.min = todayIso;
		endInput.min = todayIso;
		startInput.addEventListener('change', function () {
			highlightSelection();
			checkRange();
		});
		endInput.addEventListener('change', function () {
			highlightSelection();
			checkRange();
		});
	}
	if (form) {
		form.addEventListener('submit', onSubmit);
	}
	if (calendarEl) {
		loadMonth();
	}
})();
