/**
 * Загрузчик файлов для локализаци: выбирает путь к файлу 
 * исходя из настроек текущей страницы, а также от настроек префиксов,
 * которые указываются в настройках модуля.
 * По умолчанию в настройках в качестве префикса применяется ключ `default`.
 * Для адресов вида `prefix/file` плагин сначала проверит, есть ли
 * путь для ключа `prefix` в конфиге. Если есть, добавит к нему оставшуюся часть
 * пути, если нет — просто добавит `default` в начале: ровно так же,
 * как работает конфиг `paths` в Require.js.
 *
 * В настройках путей можно задавать токены вида `%token_name%`, которые 
 * автоматически будут вычисляться для каждого запроса. Пока поддерживается токен
 * `%lang%`.
 */
define(['module'], function(module) {

	function replaceTokens(str, data) {
		return str.replace(/%([\w\-]+)%/g, function(str, p1) {
			return data[p1] || '';
		});
	}

	return {
		load: function(name, req, onload, globalConfig) {
			var config = module.config() || {};
			var originalName = name;
			var parts = name.split('/').filter(function(item) {
				return !!item;
			});

			// резолвим префикс, который будет добавлен к названию модуля
			if (parts[0] in config) {
				parts[0] = config[parts[0]];
			} else if (config['default']) {
				parts.unshift(config['default']);
			}

			var tokens = {
				lang: document.documentElement.getAttribute('lang')
			};

			name = parts.map(function(part) {
				return replaceTokens(part, tokens);
			}).join('/') + '.js';

			// сделаем копию конфига для нового пути, если он есть
			if (globalConfig.config) {
				[originalName, 'i18n!' + originalName].forEach(function(key) {
					if (globalConfig.config[key]) {
						globalConfig.config[name] = globalConfig.config[key];
					}
				});
			}

			req([name], onload);
		}
	};
});
