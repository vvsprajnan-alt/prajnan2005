import './ui/styles.css';
import { App } from './app';

new App(document.getElementById('app')!);
const boot = document.getElementById('boot');
if (boot) {
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 500);
}
