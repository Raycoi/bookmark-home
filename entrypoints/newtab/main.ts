import { createApp } from 'vue';
import App from './App.vue';
import { t } from '../../src/i18n';
import '../../src/styles/variables.css';
import '../../src/styles/homepage.css';
import '../../src/styles/management.css';

const app = createApp(App);
app.config.globalProperties.$t = t;
app.mount('#app');
