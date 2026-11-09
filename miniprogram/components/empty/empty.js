/* 韭研 · 小程序空态组件（纯 view/文字插画） */
(function () {
  'use strict';

  var empty = {
    properties: {
      icon: { type: String, value: '📭' },
      title: { type: String, value: '暂无数据' },
      desc: { type: String, value: '' },
      actionText: { type: String, value: '' }
    },
    data: {},
    methods: {
      onAction: function () {
        this.triggerEvent('action', {});
      }
    }
  };

  if (typeof Component === 'function') {
    Component(empty);
  }
})();
