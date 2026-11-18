<template>
  <div class="loading-skeleton" aria-hidden="true">
    <section v-for="section in 2" :key="section" class="loading-skeleton__section">
      <span class="skeleton-block loading-skeleton__title"></span>
      <div class="loading-skeleton__grid">
        <div v-for="item in section === 1 ? 9 : 6" :key="item" class="loading-skeleton__item">
          <span class="skeleton-block loading-skeleton__icon"></span>
          <span class="skeleton-block loading-skeleton__name"></span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.loading-skeleton {
  display: grid;
  gap: var(--bh-section-gap);
}

.loading-skeleton__section {
  min-width: 0;
}

.loading-skeleton__title {
  display: block;
  width: 92px;
  height: 15px;
  margin-bottom: 20px;
  border-radius: 5px;
}

.loading-skeleton__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--bh-bookmark-column-min), 1fr));
  gap: var(--bh-grid-gap-y) var(--bh-grid-gap-x);
}

.loading-skeleton__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  height: var(--bh-bookmark-item-height);
  padding-top: 10px;
}

.loading-skeleton__icon {
  width: var(--bh-icon-tile-size);
  height: var(--bh-icon-tile-size);
  border-radius: calc(var(--bh-icon-tile-size) * 0.27);
}

.loading-skeleton__name {
  width: 54px;
  height: 10px;
  border-radius: 4px;
}

.skeleton-block {
  background:
    linear-gradient(
      90deg,
      rgba(35, 40, 50, 0.045) 20%,
      rgba(35, 40, 50, 0.075) 45%,
      rgba(35, 40, 50, 0.045) 70%
    );
  background-size: 220% 100%;
  animation: bh-skeleton 1.5s ease-in-out infinite;
}

@keyframes bh-skeleton {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -120% 0;
  }
}
</style>
