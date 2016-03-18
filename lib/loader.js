/**
 * «Прокачанный» загрузчик модулей для Require.js.
 * Перед загрузкой проверяет наличие файла на сервере и если его нет,
 * пытается получить main-файл из файла bower.json или package.json и,
 * если такой файл был найден, меняет внутренний маппинг модуля для того,
 * чтобы относительные субмодули правильно подгружались с учётом найденного
 * пути к пакету.
 * 
 * Также добавляет метод `requirejs.lookup()`, в который можно записать
 * каталог версионированных зависимостей. Если запрашиваемый модуль есть в каталоге,
 * он не будет проверяться на сервере.
 */
(function() {
	var reDomain = /^(\w+:)?\/\/[^\/]+/;

	// Split a filename into [root, dir, basename, ext], unix version
	// 'root' is just a slash, or nothing.
	var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
	var splitPath = function(filename) {
		return splitPathRe.exec(filename).slice(1);
	};
	
	/**
	 * Модуль для работы с путями, стырено у Node.JS
	 */
	var path = {
		resolve: function() {
			var resolvedPath = '', resolvedAbsolute = false;

			for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
				var path = (i >= 0) ? arguments[i] : '';

				// Skip empty and invalid entries
				if (typeof path !== 'string') {
					throw new TypeError('Arguments to path.resolve must be strings');
				} else if (!path) {
					continue;
				}

				resolvedPath = path + '/' + resolvedPath;
				resolvedAbsolute = path.charAt(0) === '/';
			}

			// At this point the path should be resolved to a full absolute path, but
			// handle relative paths to be safe (might happen when process.cwd() fails)

			// Normalize the path
			resolvedPath = this.normalizeArray(resolvedPath.split('/').filter(function(p) {
				return !!p;
			}), !resolvedAbsolute).join('/');

			return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
		},

		normalize: function(path) {
			var isAbsolute = this.isAbsolute(path);
			var trailingSlash = path.substr(-1) === '/';

			// Normalize the path
			path = this.normalizeArray(path.split('/').filter(function(p) {
				return !!p;
			}), !isAbsolute).join('/');

			if (!path && !isAbsolute) {
				path = '.';
			}

			if (path && trailingSlash) {
				path += '/';
			}

			return (isAbsolute ? '/' : '') + path;
		},

		normalizeArray: function(parts, allowAboveRoot) {
			// if the path tries to go above the root, `up` ends up > 0
			var up = 0;
			for (var i = parts.length - 1; i >= 0; i--) {
				var last = parts[i];
				if (last === '.') {
					parts.splice(i, 1);
				} else if (last === '..') {
					parts.splice(i, 1);
					up++;
				} else if (up) {
					parts.splice(i, 1);
					up--;
				}
			}

			// if the path is allowed to go above the root, restore leading ..s
			if (allowAboveRoot) {
				for (; up--; up) {
					parts.unshift('..');
				}
			}

			return parts;
		},

		isAbsolute: function(path) {
			return path.charAt(0) === '/';
		},

		join: function() {
			var paths = Array.prototype.slice.call(arguments, 0);
			return this.normalize(paths.filter(function(p, index) {
				if (typeof p !== 'string') {
					throw new TypeError('Arguments to path.join must be strings');
				}
				return p;
			}).join('/'));
		},

		relative: function(from, to) {
			from = this.resolve(from).substr(1);
			to = this.resolve(to).substr(1);

			function trim(arr) {
				var start = 0;
				for (; start < arr.length; start++) {
					if (arr[start] !== '') break;
				}

				var end = arr.length - 1;
				for (; end >= 0; end--) {
					if (arr[end] !== '') break;
				}

				if (start > end) return [];
				return arr.slice(start, end - start + 1);
			}

			var fromParts = trim(from.split('/'));
			var toParts = trim(to.split('/'));

			var length = Math.min(fromParts.length, toParts.length);
			var samePartsLength = length;
			for (var i = 0; i < length; i++) {
				if (fromParts[i] !== toParts[i]) {
					samePartsLength = i;
					break;
				}
			}

			var outputParts = [];
			for (var i = samePartsLength; i < fromParts.length; i++) {
				outputParts.push('..');
			}

			outputParts = outputParts.concat(toParts.slice(samePartsLength));

			return outputParts.join('/');
		},

		dirname: function(path) {
			var result = splitPath(path);
			var root = result[0];
			var dir = result[1];

			if (!root && !dir) {
				// No dirname whatsoever
				return '.';
			}

			if (dir) {
				// It has a dirname, strip trailing slash
				dir = dir.substr(0, dir.length - 1);
			}

			return root + dir;
		},
	};

	function getMainFile(data) {
		var main = data['main-debug'] || data['main'];
		if (!main) {
			return null;
		}

		var mainFile;
		if (Array.isArray(main)) {
			main.some(function(path) {
				if (/\.js$/.test(path)) {
					return mainFile = path;
				}
			});
		} else {
			mainFile = main;
		}

		if (mainFile && mainFile.charAt(0) !== '/') {
			mainFile = '/' + mainFile;
		}
		
		return mainFile;
	}

	function trimExt(file) {
		return file.replace(/\.\w+$/, '');
	}

	function probe(url, method, callback) {
		var xhr = new XMLHttpRequest();
		if (typeof method === 'function') {
			callback = method;
			method = 'GET';
		}

		xhr.open(method || 'GET', url, true);
		xhr.onreadystatechange = function() {
			if (xhr.readyState === 4) {
				callback(xhr.status === 200, xhr.responseText);
			}
		};
		xhr.send();
	}

	/**
	 * Проверяет, существует ли указанный модуль на сервере. Если нет, то
	 * пытается загрузить его как зависимость из пакета
	 * @param  {String}   url      URL модуля, полученный от RequireJS
	 * @param  {Function} callback Фукция, которая вызывается после завершения проверки.
	 * В качестве аргумента она принимает финальный URL модуля
	 */
	function probeModuleUrl(name, url, callback) {
		var base = trimExt(url);
		var queue = [base + '.js', base + '/bower.json', base + '/package.json'];
		var next = function() {
			if (!queue.length) {
				// очередь закончилась, но ни для одного URL не удалось
				// получить ссылку на модуль: считаем, что такого модуля нет,
				// поэтому возвращаем оригинальную ссылку
				return callback(url);
			}

			var item = queue.shift();
			probe(item, function(success, text) {
				if (success) {
					if (/\.json$/.test(item)) {
						// это пакет (загрузили JSON-описание пакета):
						// достаём main-файл из него
						var mainFile = getMainFile(JSON.parse(text));
						if (mainFile) {
							return callback(base + mainFile);
						}
					} else {
						// загрузили обычный JS-файл
						return callback(item);
					}
				}

				// Если дошли до этого места — значит либо запрашиваемый URL
				// отсутствует, либо в пакете нет main-файла.
				// Пробуем следующую ссылку в очереди
				next();
			});
		}
		next();
	}

	/**
	 * Делит URL на домен и фактический путь
	 * @param  {String} url
	 * @return {Object}
	 */
	function splitUrl(url) {
		var domain = '', path = url;
		var m = url.match(reDomain);
		if (m) {
			domain = m[0];
			path = url.substr(domain.length);
		}

		return {
			domain: domain,
			path: path
		};
	}

	/**
	 * Исправляет имя модуля для правильной адресации субмодулей
	 * внутри пакета.
	 *
	 * Когда загружается пакет, например, `package/deb`, его 
	 * фактический файл может располагаться по адресу `/packages/dep/lib/file.js`
	 * (получено из bower.json или package.json). Однако Require.js резолвит пути
	 * относительно имени пакета, а не адреса, с которого он загружен.
	 * Поэтому если найденный файл будет запрашивать субмодуль `./sub.js`, он будет
	 * отрезолвлен в `package/sub.js`, а должен в `/packages/dep/lib/sub.js`.
	 * Этот метод исправляет внутреннее имя модуля так, чтобы все дочерние зависимости
	 * правильно резолвились самим Require.js
	 * 
	 * @param  {Module} module      Определение модуля
	 * @param  {String} resolvedUrl Финальный URL пакета
	 */
	function fixPackageName(module, resolvedUrl) {
		var resolved = splitUrl(resolvedUrl);
		// var actual = splitUrl(module.map.url);
		// var delta = path.relative(actual.path, resolved.path);
		// var dest = path.normalize(path.join(module.map.name, delta));
		var dest = resolved.path;
		if (resolved.domain) {
			if (dest.charAt(0) !== '/') {
				dest = '/' + dest;
			}

			dest = resolved.domain + dest;
		}

		module.map.name = dest;
	}

	/**
	 * Нормализация URL загружаемого модуля: проверяет, чтобы у него 
	 * было расширение, а если нет, то добавляет `.js`
	 * @param  {String} url
	 * @return {String}
	 */
	function normalizeUrl(url) {
		if (!/\.\w+$/.test(url)) {
			url += '.js';
		}
		return url;
	}

	/**
	 * Нормализация ES6 модуля для правильной работы модулей.
	 * @param  {Module} module
	 * @return {Module}
	 */
	function normalizeES6Module(module) {
		if (module && module.__esModule) {
			return module.default != null ? module.default : module;
		}
		return module;
	}

	/**
	 * Исправляет механизм резолвинга модулей для правильной работы ES6 модулей.
	 * @param  {Factory} localRequire Фабрика для создания функции `require` или сама функция `require`
	 * @return {Factory}
	 */
	function patchRequire(localRequire) {
		function patchedRequire(deps, callback, errback) {
			var patchedCallback = typeof(callback) !== 'function' ? callback : function() {
				var args = Array.prototype.slice
					.call(arguments, 0)
					.map(normalizeES6Module);

				return callback.apply(this, args);
			};
			var result = localRequire.call(this, deps, patchedCallback, errback);

			if (typeof(result) !== 'function') {
				return normalizeES6Module(result);
			}
			return result;
		};

		Object
			.keys(localRequire)
			.forEach(function(name) {
				patchedRequire[name] = localRequire[name];
			});

		return patchedRequire;
	}

	/**
	 * Исправляет методы резолвинга модулей в переданном контексте.
	 * @param  {Object} ctx Контекст исполнения и резолвинга модулей
	 * @return {Object}
	 */
	function patchContext(ctx) {
		ctx.require = patchRequire(ctx.require);
		ctx.makeRequire = (function(localMakeRequire) {
			return function(relMap, options) {
				return patchRequire(localMakeRequire.apply(this, arguments));
			}
		})(ctx.makeRequire);
		return ctx;
	}

	// Делаем исправление глобального контекста.
	patchContext(requirejs.s.contexts._);

	// Исправляем глобальную фабрику по созданию новых контекстов чтоб они сразу имели 
	// исправленные методы резолвинга модулей.
	requirejs.s.contexts.newContext = (function(newContext) {
		return function() {
			return patchContext(newContext.apply(this, arguments));
		}
	})(requirejs.s.contexts.newContext);

	var rjsLoad = requirejs.load;
	var lookup = {};
	requirejs.lookup = function(value) {
		if (typeof value === 'object') {
			return lookup = value;
		}

		if (typeof value === 'string') {
			value = value.replace(/\.js$/, '');
			return lookup[value] || lookup[value + '.js'];
		}

		return lookup;
	};

	requirejs.load = function(context, moduleName, url) {
		var config = context.config;
		var resolvedUrl = requirejs.lookup(moduleName) || requirejs.lookup(url);
		if (resolvedUrl || moduleName in config.paths || reDomain.test(url)) {
			// 1. этот модуль есть в лукапе: нет смысла его проверять
			// 2. путь к модулю либо абсолютный, либо явно указан в конфиге: 
			// не будем его проверять
			return rjsLoad.call(this, context, moduleName, normalizeUrl(resolvedUrl || url));
		}

		probeModuleUrl(moduleName, url, function(resolvedUrl) {
			// меняем внутреннюю ссылку на модуль, чтобы все последующие 
			// субмодули правильно резолвились
			var mod = context.registry[moduleName];
			if (mod.map.url !== resolvedUrl) {
				// console.log('Use %s for package %c%s', resolvedUrl, 'font-weight:bold', moduleName);
				
				if (/^packages\//.test(moduleName)) {
					fixPackageName(mod, resolvedUrl);
				}

				mod.map.url = resolvedUrl;
				context.registry[mod.map.name] = mod;
			}

			rjsLoad.call(this, context, moduleName, resolvedUrl);
		});
	};
})();
