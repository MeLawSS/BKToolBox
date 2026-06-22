<script setup>
import logoUrl from '../../BidKing.png';
import TopBar from '../shared/TopBar.vue';
import { useI18n } from '../shared/i18n.js';

const { t } = useI18n();
</script>

<template>
  <TopBar active-page="home" />

  <main class="page">
    <section class="hero">
      <div class="hero-mark" aria-hidden="true">
        <img :src="logoUrl" alt="">
      </div>
      <div class="hero-copy">
        <h1>{{ t('home.title') }}</h1>
        <p>{{ t('home.subtitle') }}</p>
      </div>
    </section>

    <section class="launcher" :aria-label="t('home.launcherLabel')">
      <header class="section-head">
        <h2>{{ t('home.launcherTitle') }}</h2>
        <p>{{ t('home.launcherSubtitle') }}</p>
      </header>

      <div class="launcher-list">
        <a class="launcher-link" href="/Tools">
          <span class="launcher-title">{{ t('common.tools') }}</span>
          <span class="launcher-text">{{ t('home.toolsText') }}</span>
        </a>

        <a class="launcher-link" href="/Monitor">
          <span class="launcher-title">{{ t('common.monitor') }}</span>
          <span class="launcher-text">{{ t('home.monitorText') }}</span>
        </a>


        <a class="launcher-link" href="/Inject">
          <span class="launcher-title">{{ t('common.inject') }}</span>
          <span class="launcher-text">{{ t('home.injectText') }}</span>
        </a>
      </div>
    </section>

  </main>
</template>
