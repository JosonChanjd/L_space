/* 韭研 · 小程序加载态组件 */
(function () {
  'use strict';

  var loading = {
    properties: {
      text: { type: String, value: '加载中…' }
    },
    data: {},
    methods: {}
  };

  if (typeof Component === 'function') {
    Component(loading);
  }
})();
