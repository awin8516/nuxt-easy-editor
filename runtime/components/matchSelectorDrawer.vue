<template>
  <transition name="drawer">
    <div v-if="isVisible" class="drawer-overlay" @click.self="close">
      <div class="drawer-container" :class="direction">
        <div class="drawer-header">
          <h3>{{ title }}</h3>
          <button @click="close" class="close-btn">×</button>
        </div>
        <div class="drawer-body">
          <p class="drawer-subtitle">找到 {{ matches.length }} 处匹配，请选择要修改的位置：</p>
          <div class="match-list">
            <div
              v-for="(match, index) in matches"
              :key="index"
              class="match-item"
              :class="{ active: selectedIndex === index }"
              @click="selectMatch(index)"
            >
              <div class="match-info">
                <strong>{{ match.file }}</strong>
                <span class="match-location">第 {{ match.line }} 行</span>
              </div>
              <div class="match-preview">{{ match.context }}</div>
            </div>
          </div>
        </div>
        <div class="drawer-footer">
          <button @click="close" class="btn btn-cancel">取消</button>
          <button @click="confirmSelection" class="btn btn-confirm">确定</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Match {
  file: string
  line: number
  context: string
  originalContent: string
}

const props = defineProps<{
  isVisible: boolean
  title: string
  matches: Match[]
  direction?: 'right' | 'left' | 'top' | 'bottom'
}>()

const emit = defineEmits<{
  close: []
  select: [matchIndex: number]
}>()

const selectedIndex = ref(0)

const close = () => {
  emit('close')
}

const selectMatch = (index: number) => {
  selectedIndex.value = index
}

const confirmSelection = () => {
  emit('select', selectedIndex.value)
  close()
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: stretch;
  z-index: 999999;
  color: #000;
}

.drawer-container {
  background: white;
  width: 400px;
  max-width: 80vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.drawer-container.right {
  margin-left: auto;
}

.drawer-container.left {
  margin-right: auto;
}

.drawer-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.drawer-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #6b7280;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.drawer-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.drawer-subtitle {
  margin: 0 0 16px 0;
  color: #6b7280;
  font-size: 14px;
}

.match-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.match-item {
  padding: 14px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.match-item:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

.match-item.active {
  border-color: #3b82f6;
  background: #dbeafe;
}

.match-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.match-info strong {
  color: #111827;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 10px;
}

.match-location {
  color: #6b7280;
  font-size: 12px;
  white-space: nowrap;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 12px;
}

.match-preview {
  color: #6b7280;
  font-size: 12px;
  font-family: monospace;
  white-space: pre-wrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 50px;
  line-height: 1.4;
}

.drawer-footer {
  padding: 16px 20px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-shrink: 0;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-cancel {
  background: #f3f4f6;
  color: #374151;
}

.btn-cancel:hover {
  background: #e5e7eb;
}

.btn-confirm {
  background: #3b82f6;
  color: white;
}

.btn-confirm:hover {
  background: #2563eb;
}

/* 过渡动画 */
.drawer-enter-active,
.drawer-leave-active {
  transition: all 0.3s ease;
}

.drawer-enter-from .drawer-container.right,
.drawer-leave-to .drawer-container.right {
  transform: translateX(100%);
}

.drawer-enter-from .drawer-container.left,
.drawer-leave-to .drawer-container.left {
  transform: translateX(-100%);
}

.drawer-enter-from .drawer-container.top,
.drawer-leave-to .drawer-container.top {
  transform: translateY(-100%);
}

.drawer-enter-from .drawer-container.bottom,
.drawer-leave-to .drawer-container.bottom {
  transform: translateY(100%);
}
</style>