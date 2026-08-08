/**
 * Avably Booking — blok Gutenberga (edytor).
 *
 * Blok jest dynamiczny (render.php) — w edytorze pokazujemy placeholder,
 * bo pełny flow wymaga żywego API i nie ma czego renderować w iframe edytora.
 */
(function (blocks, element, i18n) {
	'use strict';

	var el = element.createElement;
	var __ = i18n.__;

	blocks.registerBlockType('avably/booking', {
		edit: function () {
			return el(
				'div',
				{
					style: {
						border: '1px dashed #999',
						borderRadius: '6px',
						padding: '1.5rem',
						textAlign: 'center',
						color: '#555'
					}
				},
				el('strong', {}, 'Avably Booking'),
				el(
					'p',
					{ style: { margin: '0.5rem 0 0' } },
					__('The booking flow (catalog, calendar, reservation form) will appear here on the published page.', 'avably-booking')
				)
			);
		},
		save: function () {
			return null;
		}
	});
})(window.wp.blocks, window.wp.element, window.wp.i18n);
