'use strict';

var fs = require('fs');
var path = require('path');
var EOL = require('os').EOL;
var utils = require('./');

/**
 * @method utils.camelize
 * @description
 * Camelizes a text string.
 *
 * Case-changing characters include:
 * - hyphen
 * - underscore
 * - period
 * - space
 *
 * @param {string} text
 * Input text string.
 *
 * @returns {string}
 * Camelized text string.
 *
 */
function camelize(text) {
    text = text.replace(/[\-_\s\.]+(.)?/g, function (match, chr) {
        return chr ? chr.toUpperCase() : '';
    });
    return text.substr(0, 1).toLowerCase() + text.substr(1);
}

/**
 * @method utils.camelizeVar
 * @description
 * Camelizes a text string, while making it compliant with JavaScript variable names:
 * - contains symbols `a-Z`, `A-Z`, `0-9`, `_` and `$`
 * - cannot have leading digits
 *
 * @param {string} text
 * Input text string.
 *
 * If it doesn't contain any symbols to make up a valid variable name, the result will be an empty string.
 *
 * @returns {string}
 * Camelized text string that can be used as an open property name.
 *
 */
function camelizeVar(text) {
    text = text.replace(/[^a-zA-Z0-9\$_\-\s\.]/g, '').replace(/^[0-9_\-\s\.]+/, '');
    return camelize(text);
}

function _enumSql(dir, options, cb, namePath) {
    var tree = {};
    fs.readdirSync(dir).forEach(function (file) {
        var stat, p = path.join(dir, file);
        try {
            stat = fs.statSync(p);
        } catch (e) {
            // while it is very easy to test manually, it is very difficult to test for
            // access-denied errors automatically; therefore excluding from the coverage:
            // istanbul ignore next
            if (options.ignoreErrors) {
                return;
            } else {
                throw e;
            }
        }
        if (stat.isDirectory()) {
            if (options.recursive) {
                var dirName = camelizeVar(file);
                var np = namePath ? (namePath + '.' + dirName) : dirName;
                var t = _enumSql(p, options, cb, np);
                if (Object.keys(t).length) {
                    if (!dirName.length || dirName in tree) {
                        if (!options.ignoreErrors) {
                            throw new Error("Empty or duplicate camelized folder name: " + p);
                        }
                    }
                    tree[dirName] = t;
                }
            }
        } else {
            if (path.extname(file).toLowerCase() === '.sql') {
                var name = camelizeVar(file.replace(/\.[^/.]+$/, ''));
                if (!name.length || name in tree) {
                    if (!options.ignoreErrors) {
                        throw new Error("Empty or duplicate camelized file name: " + p);
                    }
                }
                tree[name] = p;
                if (cb) {
                    var result = cb(p, name, namePath ? (namePath + '.' + name) : name);
                    if (result !== undefined) {
                        tree[name] = result;
                    }
                }
            }
        }
    });
    return tree;
}

/**
 * @method utils.enumSql
 * @description
 * Synchronously enumerates all SQL files (for a given directory) into an SQL tree.
 *
 * All property names within the tree are camelized via {@link utils.camelizeVar camelizeVar},
 * so they can be used in the code directly, as open property names.
 *
 * @param {string} dir
 * Directory where SQL files are located.
 *
 * @param {object} [options]
 * Search options.
 *
 * @param {boolean} [options.recursive=false]
 * Include sub-directories into the search.
 *
 * Sub-directories without SQL files will be skipped from the result.
 *
 * @param {boolean} [options.ignoreErrors=false]
 * Ignore the following types of errors:
 * - access errors, when there is no read access to a file or folder
 * - empty or duplicate camelized property names
 *
 * This flag does not affect errors related to invalid input parameters.
 *
 * @param {function} [cb]
 * A callback function that takes three arguments:
 * - `file` - full sql file name
 * - `name` - name of the property that represents the sql file
 * - `path` - property resolution path (full property name)
 *
 * If the function returns anything other than `undefined`, it overrides the corresponding property value in the tree.
 *
 * @returns {object}
 * Camelized SQL tree object, with each value being an SQL file path.
 *
 * @example
 *
 * // simple SQL tree generation for further processing:
 * var tree = pgp.utils.enumSql('../sql', {recursive: true});
 *
 * @example
 *
 * // generating an SQL tree for dynamic-names queries:
 * var sql = pgp.utils.enumSql('../sql', {recursive: true}, file=> {
 *     return new pgp.QueryFile(file, {minify: true});
 * });
 *
 * @example
 *
 * var path = require('path');
 *
 * // replacing each relative path in the tree with a full one:
 * var tree = pgp.utils.enumSql('../sql', {recursive: true}, file=> {
 *     return path.join(__dirname, file);
 * });
 *
 */
function enumSql(dir, options, cb) {
    if (!dir || typeof dir !== 'string') {
        throw new TypeError("Parameter 'dir' must be a non-empty text string.");
    }
    if (!options || typeof options !== 'object') {
        options = {};
    }
    cb = (typeof cb === 'function') ? cb : null;
    return _enumSql(dir, options, cb, '');
}

/**
 *
 * @method utils.objectToCode
 * @description
 * Translates an object tree into a well-formatted JSON code string.
 *
 * @param {object} obj
 * Source tree object.
 *
 * @param {function} [cb]
 * A callback function to override property values for the code.
 *
 * It takes three arguments:
 *
 * - `value` - property value
 * - `name` - property name
 * - `obj` - current object (which contains the property)
 *
 * The returned value is used as is for the property value in the generated code.
 *
 * @returns {string}
 *
 * @example
 *
 * // Generating code for a simple object
 *
 * var tree = {one: 1, two: {item: 'abc'}};
 *
 * var code = pgp.utils.objectToCode(tree);
 *
 * console.log(code);
 * //=>
 * // {
 * //     one: 1,
 * //     two: {
 * //         item: "abc"
 * //     }
 * // }
 *
 * @example
 *
 * // Generating a Node.js module with an SQL tree
 *
 * var fs = require('fs');
 * var EOL = require('os').EOL;
 *
 * // generating an SQL tree from the folder:
 * var tree = pgp.utils.enumSql('./sql', {recursive: true});
 *
 * // generating the module's code:
 * var code = "var load = require('./loadSql');" + EOL + EOL + "module.exports = " +
 *         pgp.utils.objectToCode(tree, function (value) {
 *             return 'load(' + JSON.stringify(value) + ')';
 *         }) + ';';
 *
 * // saving the module:
 * fs.writeFileSync('sql.js', code);
 *
 * @example
 *
 * // generated code example (file sql.js)
 *
 * var load = require('./loadSql');
 *
 * module.exports = {
 *     events: {
 *         add: load("../sql/events/add.sql"),
 *         delete: load("../sql/events/delete.sql"),
 *         find: load("../sql/events/find.sql"),
 *         update: load("../sql/events/update.sql")
 *     },
 *     products: {
 *         add: load("../sql/products/add.sql"),
 *         delete: load("../sql/products/delete.sql"),
 *         find: load("../sql/products/find.sql"),
 *         update: load("../sql/products/update.sql")
 *     },
 *     users: {
 *         add: load("../sql/users/add.sql"),
 *         delete: load("../sql/users/delete.sql"),
 *         find: load("../sql/users/find.sql"),
 *         update: load("../sql/users/update.sql")
 *     },
 *     create: load("../sql/create.sql"),
 *     init: load("../sql/init.sql"),
 *     drop: load("../sql/drop.sql")
 *};
 *
 * @example
 *
 * // loadSql.js module example
 *
 * var QueryFile = require('pg-promise').QueryFile;
 *
 * module.exports = function(file) {
 *     return new QueryFile(file, {minify: true});
 * };
 *
 */
function objectToCode(obj, cb) {

    if (!obj || typeof obj !== 'object') {
        throw new TypeError("Parameter 'obj' must be a non-null object.");
    }

    cb = (typeof cb === 'function') ? cb : null;

    return '{' + generate(obj, 1) + EOL + '}';

    function generate(obj, level) {
        var code = '', gap = utils.messageGap(level);
        var idx = 0;
        for (var prop in obj) {
            var value = obj[prop];
            if (value && typeof value === 'object') {
                if (idx) {
                    code += ',';
                }
                code += EOL + gap + prop + ': {';
                code += generate(value, level + 1);
                code += EOL + gap + '}';
            } else {
                if (idx) {
                    code += ',';
                }
                code += EOL + gap + prop + ': ';
                if (cb) {
                    code += cb(value, prop, obj);
                } else {
                    code += JSON.stringify(value);
                }
            }
            idx++;
        }
        return code;
    }
}

/**
 * @method utils.buildSqlModule
 * @description
 * **Added in v.4.3.8**
 *
 * Synchronously generates a Node.js module with an SQL tree, based on a configuration object that has the format shown below.
 *
 * This method is normally to be used on a grunt/gulp watch that triggers when the file structure changes in your SQL directory,
 * although it can be invoked manually as well.
 *
 * ```js
 * {
 *    // Required Properties:
 *    
 *    "dir" // {string}: relative or absolute directory where SQL files are located (see API for method enumSql, parameter `dir`)
 *
 *    // Optional Properties:
 *    
 *    "recursive" // {boolean}: search for sql files recursively (see API for method enumSql, option `recursive`)
 *
 *    "ignoreErrors" // {boolean}: ignore common errors (see API for method enumSql, option `ignoreErrors`)
 *
 *    "output" // {string}: relative or absolute destination file path; when not specified, no file is created,
 *             // but you still can use the code string that's always returned by the method.
 *     
 *    "module": {
 *        "path" // {string}: relative path to a module exporting a function which takes a file path
 *               // and returns a proper value (typically, a new QueryFile object); by default, it uses `./loadSql`.
 *
 *        "name" // {string}: local variable name for the SQL-loading module; by default, it uses `load`.
 *    }
 * }
 * ```
 *
 * @param {object|string} [config]
 * Configuration parameter for generating the code.
 *
 * - When it is a non-null object, it is assumed to be a configuration object (see the format above).
 * - When it is a text string - it is the relative path to a JSON file that contains the configuration object.
 * - When `config` isn't specified, the method will try to locate the default `sql-config.json` file in the same folder as
 *   your module's start-up file, and if not found - throw {@link external:Error Error} = `Default SQL configuration file not found`.
 *
 * @returns {string}
 * Generated code.
 *
 * @example
 *
 * // generate SQL module automatically, from sql-config.json in the module's start-up folder:
 *
 * pgp.utils.buildSqlModule();
 *
 * // see generated file below:
 *
 * @example
 *
 * /////////////////////////////////////////////////////////////////////////
 * // This file was automatically generated by pg-promise v.4.3.8
 * //
 * // Generated on: 6/2/2016, at 2:15:23 PM
 * // Total files: 15
 * //
 * // API: http://vitaly-t.github.io/pg-promise/utils.html#.buildSqlModule
 * /////////////////////////////////////////////////////////////////////////
 *
 * var load = require('./loadSql');
 *
 * module.exports = {
 *     events: {
 *         add: load("../sql/events/add.sql"),
 *         delete: load("../sql/events/delete.sql"),
 *         find: load("../sql/events/find.sql"),
 *         update: load("../sql/events/update.sql")
 *     },
 *     products: {
 *         add: load("../sql/products/add.sql"),
 *         delete: load("../sql/products/delete.sql"),
 *         find: load("../sql/products/find.sql"),
 *         update: load("../sql/products/update.sql")
 *     },
 *     users: {
 *         add: load("../sql/users/add.sql"),
 *         delete: load("../sql/users/delete.sql"),
 *         find: load("../sql/users/find.sql"),
 *         update: load("../sql/users/update.sql")
 *     },
 *     create: load("../sql/create.sql"),
 *     init: load("../sql/init.sql"),
 *     drop: load("../sql/drop.sql")
 *};
 *
 */
function buildSqlModule(config) {

    // root = folder where the start-up js file is located
    var root = path.dirname(process.argv[1]);

    if (config) {
        if (typeof config === 'string') {
            config = require(path.join(root, config));
        } else {
            if (typeof config !== 'object') {
                throw new TypeError("Invalid parameter 'config' specified.");
            }
        }
    } else {
        var defConfig = path.join(root, 'sql-config.json');
        // istanbul ignore else;
        if (!fs.existsSync(defConfig)) {
            throw new Error("Default SQL configuration file not found: " + defConfig);
        }
        // cannot test this automatically, because it requires that file 'sql-config.json'
        // resides within the jasmine folder, since it is the client during the test.
        // istanbul ignore next;
        config = require(defConfig);
    }

    if (!utils.isText(config.dir)) {
        throw new Error("Property 'dir' must be a non-empty string.");
    }

    var total = 0;
    var tree = enumSql(config.dir, {recursive: config.recursive, ignoreErrors: config.ignoreErrors}, function () {
        total++;
    });

    var modulePath = './loadSql', moduleName = 'load';
    if (config.module && typeof config.module === 'object') {
        if (utils.isText(config.module.path)) {
            modulePath = config.module.path;
        }
        if (utils.isText(config.module.name)) {
            moduleName = config.module.name;
        }
    }

    var d = new Date();

    var header =
        "/////////////////////////////////////////////////////////////////////////" + EOL +
        "// This file was automatically generated by pg-promise v." + require('../../package.json').version + EOL +
        "//" + EOL +
        "// Generated on: " + d.toLocaleDateString() + ', at ' + d.toLocaleTimeString() + EOL +
        "// Total files: " + total + EOL +
        "//" + EOL +
        "// API: http://vitaly-t.github.io/pg-promise/utils.html#.buildSqlModule" + EOL +
        "/////////////////////////////////////////////////////////////////////////" + EOL + EOL +
        "'use strict';" + EOL + EOL +
        "var " + moduleName + " = require('" + modulePath + "');" + EOL + EOL +
        "module.exports = ";

    var code = header + objectToCode(tree, function (value) {
            return moduleName + '(' + JSON.stringify(value) + ')';
        }) + ';';

    if (utils.isText(config.output)) {
        fs.writeFileSync(config.output, code);
    }

    return code;
}


/**
 * @namespace utils
 *
 * @description
 * **Added in v.4.3.6**
 *
 * Namespace for general-purpose static functions, available as `pgp.utils`, before and after initializing the library.
 *
 * Its main purpose is to simplify developing projects with large number of SQL files
 * (see [Automatic SQL Trees](https://github.com/vitaly-t/pg-promise/issues/153)).
 *
 * @property {function} camelize
 * {@link utils.camelize camelize} - camelizes a text string
 *
 * @property {function} camelizeVar
 * {@link utils.camelizeVar camelizeVar} - camelizes a text string as a variable
 *
 * @property {function} enumSql
 * {@link utils.enumSql enumSql} - enumerates SQL files in a directory
 *
 * @property {function} objectToCode
 * {@link utils.objectToCode objectToCode} - generates code from an object
 *
 * @property {function} buildSqlModule
 * {@link utils.buildSqlModule buildSqlModule} - generates a complete Node.js module
 *
 */
module.exports = {
    camelize: camelize,
    camelizeVar: camelizeVar,
    enumSql: enumSql,
    objectToCode: objectToCode,
    buildSqlModule: buildSqlModule
};