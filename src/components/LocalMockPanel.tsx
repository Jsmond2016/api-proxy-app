import { Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Space, Table } from "antd";
import type { TableColumnsType } from "antd";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { LocalMockResponse, LocalMockResponseInput } from "../types";

interface LocalMockPanelProps {
  profileId: string;
  responses: LocalMockResponse[];
  onSave: (input: LocalMockResponseInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function LocalMockPanel(props: LocalMockPanelProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocalMockResponse | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm<LocalMockResponseInput>();
  function startCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: "", delayMs: 0, status: 200, body: "" });
    setFormOpen(true);
  }
  function startEdit(item: LocalMockResponse) {
    setEditing(item);
    form.resetFields();
    form.setFieldsValue({
      profileId: props.profileId,
      name: item.name,
      delayMs: item.delayMs,
      status: item.status,
      body: item.body,
    });
    setFormOpen(true);
  }
  function startCopy(item: LocalMockResponse) {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      profileId: props.profileId,
      name: `${item.name}-copy`,
      delayMs: item.delayMs,
      status: item.status,
      body: item.body,
    });
    setFormOpen(true);
  }
  async function submit(values: LocalMockResponseInput) {
    const input = {
      ...values,
      profileId: props.profileId,
      id: editing?.id,
      delayMs: values.delayMs ?? 0,
      status: values.status ?? 200,
    };
    await props.onSave(input);
    setFormOpen(false);
    setEditing(null);
  }
  const columns: TableColumnsType<LocalMockResponse> = [
    { title: "响应名字", dataIndex: "name" },
    { title: "HTTP 状态", dataIndex: "status", width: 110 },
    { title: "延时", dataIndex: "delayMs", width: 90, render: (value) => `${value} ms` },
    {
      title: "操作",
      key: "actions",
      width: 145,
      render: (_, item) => (
        <Space>
          <Button
            aria-label="编辑预设响应"
            icon={<Pencil size={14} />}
            onClick={() => startEdit(item)}
            type="text"
          />
          <Button
            aria-label="复制预设响应"
            icon={<Copy size={14} />}
            onClick={() => startCopy(item)}
            type="text"
          />
          <Popconfirm
            cancelText="取消"
            okText="删除"
            onConfirm={() => props.onDelete(item.id)}
            title={`删除“${item.name}”？`}
          >
            <Button aria-label="删除预设响应" danger icon={<Trash2 size={14} />} type="text" />
          </Popconfirm>
        </Space>
      ),
    },
  ];
  let formTitle = "新增预设响应";
  if (editing) formTitle = "编辑预设响应";
  return (
    <>
      <Button icon={<Plus size={15} />} onClick={() => setOpen(true)}>
        新建本地 Mock
      </Button>
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={() => setOpen(false)}
        open={open}
        title="本地 Mock 响应"
      >
        <div className="local-mock-toolbar">
          <Button icon={<Plus size={15} />} onClick={startCreate} type="primary">
            新增
          </Button>
        </div>
        <Table
          columns={columns}
          dataSource={props.responses}
          locale={{
            emptyText: <Empty description="暂无预设响应" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
          }}
          pagination={false}
          rowKey="id"
          size="small"
        />
        <Modal
          destroyOnHidden
          onCancel={() => setFormOpen(false)}
          onOk={() => {
            void form.submit();
          }}
          open={formOpen}
          title={formTitle}
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={submit}
            initialValues={{ delayMs: 0, status: 200 }}
          >
            <Form.Item
              label="响应名字"
              name="name"
              rules={[{ required: true, message: "请输入响应名字" }]}
            >
              <Input placeholder="例如：成功、失败、异常" />
            </Form.Item>
            <div className="form-grid">
              <Form.Item label="延时返回（毫秒）" name="delayMs">
                <InputNumber min={0} max={60000} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="HTTP 状态" name="status" rules={[{ required: true }]}>
                <InputNumber min={100} max={599} style={{ width: "100%" }} />
              </Form.Item>
            </div>
            <Form.Item label="响应体" name="body">
              <Input.TextArea
                autoSize={{ minRows: 8, maxRows: 18 }}
                placeholder="粘贴 JSON 或文本响应"
              />
            </Form.Item>
          </Form>
        </Modal>
      </Modal>
    </>
  );
}
