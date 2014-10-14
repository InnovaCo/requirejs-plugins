/**
 * Загрузчик скриптов БЭМ-блоков для 4game: автоматически 
 * строит пути к блокам исходя из указанного имени. Примеры:
 * - require('block!MySuperBlock') → загрузит %prefix%/MySuperBlock/MySuperBlock.js
 * - require('block!MySuperBlock/submodule') → загрузит %prefix%/MySuperBlock/submodule.js
 *
 * В конфиге модуля можно указать `prefix`: путь, который будет добавлен 
 * к названию модуля.
 */
define(['module'], function(module) {
	return {
		load: function(name, req, onload, globalConfig) {
			var originalName = name;
			var parts = name.split('/').filter(function(item) {
				return !!item;
			});

			if (parts.length === 1) {
				parts.push(parts[0]);
			}

			name = parts.join('/') + '.js';
			var config = module.config() || {};
			var prefix = (config.prefix || '').trim();
			if (prefix) {
				if (prefix.charAt(prefix.length - 1) !== '/') {
					prefix += '/';
				}
				name = prefix + name;
			}

			// сделаем копию конфига для нового пути, если он есть
			if (globalConfig.config) {
				[originalName, 'block!' + originalName].forEach(function(key) {
					if (globalConfig.config[key]) {
						globalConfig.config[name] = globalConfig.config[key];
					}
				});
			}

			req([name], onload);
		}
	};
});
