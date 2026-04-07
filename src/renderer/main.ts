import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import Button from "primevue/button";
import Card from "primevue/card";
import Message from "primevue/message";
import Avatar from "primevue/avatar";
import App from "./App.vue";
import "primeicons/primeicons.css";
import "./index.css";

const app = createApp(App);

app.use(PrimeVue, {
  theme: {
    preset: Aura,
  },
});

app.component("PButton", Button);
app.component("PCard", Card);
app.component("PMessage", Message);
app.component("PAvatar", Avatar);

app.mount("#root");