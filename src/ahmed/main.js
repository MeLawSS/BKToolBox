import { createApp } from 'vue';
import App from './App.vue';
import '../../public/number-pad.css';
import '../../public/ahmed/ahmed.css';

async function mount() {
  createApp(App).mount('#app');

  await import('../../public/theme.js');
  await import('../../public/number-pad.js');
}

mount();
