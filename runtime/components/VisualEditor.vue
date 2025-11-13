<template>
  <div v-if="isEditing" class="visual-editor-overlay" @click.self="cancelEdit">
    <div class="visual-editor-modal">
      <div class="visual-editor-header">
        <h3>编辑内容</h3>
        <button @click="cancelEdit" class="close-btn">×</button>
      </div>
      <div class="visual-editor-body">
        <div v-if="matches.length > 1" class="match-selector">
          <p>找到 {{ matches.length }} 处匹配，请选择要修改的位置：</p>
          <div class="match-list">
            <div
              v-for="(match, index) in matches"
              :key="index"
              class="match-item"
              :class="{ active: selectedMatchIndex === index }"
              @click="selectedMatchIndex = index"
            >
              <div class="match-info">
                <strong>{{ match.file }}</strong>
                <span class="match-location">第 {{ match.line }} 行</span>
              </div>
              <div class="match-preview">{{ match.context }}</div>
            </div>
          </div>
        </div>
        <div class="editor-content">
          <label>内容：</label>
          <textarea
            v-model="editValue"
            class="editor-textarea"
            rows="6"
            @keydown.ctrl.enter="saveEdit"
            @keydown.meta.enter="saveEdit"
          ></textarea>
        </div>
      </div>
      <div class="visual-editor-footer">
        <button @click="cancelEdit" class="btn btn-cancel">取消</button>
        <button @click="saveEdit" class="btn btn-save" :disabled="saving">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Match {
  file: string
  line: number
  context: string
  originalContent: string
}

const props = defineProps<{
  modelValue: boolean
  originalContent: string
  matches: Match[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [content: string, matchIndex: number]
}>()

const isEditing = ref(props.modelValue)
const editValue = ref(props.originalContent)
const selectedMatchIndex = ref(0)
const saving = ref(false)

watch(() => props.modelValue, (val) => {
  isEditing.value = val
  if (val) {
    editValue.value = props.originalContent
    selectedMatchIndex.value = 0
  }
})

watch(() => props.originalContent, (val) => {
  editValue.value = val
})

const cancelEdit = () => {
  emit('update:modelValue', false)
}

const saveEdit = async () => {
  if (saving.value) return
  saving.value = true
  try {
    await emit('save', editValue.value, selectedMatchIndex.value)
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.visual-editor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999999;
  color: #000;
}

.visual-editor-modal {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.visual-editor-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.visual-editor-header h3 {
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

.visual-editor-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.match-selector {
  margin-bottom: 20px;
}

.match-selector p {
  margin: 0 0 12px 0;
  color: #6b7280;
  font-size: 14px;
}

.match-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.match-item {
  padding: 12px;
  border: 2px solid #e5e7eb;
  border-radius: 6px;
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
  margin-bottom: 6px;
}

.match-info strong {
  color: #111827;
  font-size: 14px;
}

.match-location {
  color: #6b7280;
  font-size: 12px;
}

.match-preview {
  color: #6b7280;
  font-size: 12px;
  font-family: monospace;
  white-space: pre-wrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 40px;
}

.editor-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-content label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.editor-textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}

.editor-textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.visual-editor-footer {
  padding: 16px 20px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
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

.btn-save {
  background: #3b82f6;
  color: white;
}

.btn-save:hover:not(:disabled) {
  background: #2563eb;
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>

