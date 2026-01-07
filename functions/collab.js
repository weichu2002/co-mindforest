// functions/collab.js - 阿里云ESA协作后端
// 使用KV存储实现协作房间

export default {
  async fetch(request, env, ctx) {
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || (await request.json())?.action;

    try {
      switch (action) {
        case 'create_room':
          return await handleCreateRoom(request, env);
        case 'join_room':
          return await handleJoinRoom(request, env);
        case 'leave_room':
          return await handleLeaveRoom(request, env);
        case 'send_operation':
          return await handleSendOperation(request, env);
        case 'get_updates':
          return await handleGetUpdates(request, env);
        case 'get_room_info':
          return await handleGetRoomInfo(request, env);
        default:
          return new Response(JSON.stringify({ error: '未知操作' }), {
            status: 400,
            headers: corsHeaders
          });
      }
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        code: "INTERNAL_ERROR"
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};

// 创建房间
async function handleCreateRoom(request, env) {
  const { roomId, roomData, snapshot, userId, userName } = await request.json();
  
  // 存储房间数据到KV
  const roomKey = `room:${roomId}`;
  const room = {
    ...roomData,
    snapshot,
    operations: [],
    lastUpdated: Date.now()
  };
  
  // 使用KV存储
  if (env.COLLAB_KV) {
    await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
  }
  
  return new Response(JSON.stringify({
    success: true,
    roomId,
    message: '房间创建成功'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 加入房间
async function handleJoinRoom(request, env) {
  const { roomId, userId, userName, userData } = await request.json();
  
  let room;
  const roomKey = `room:${roomId}`;
  
  if (env.COLLAB_KV) {
    const roomData = await env.COLLAB_KV.get(roomKey);
    if (!roomData) {
      return new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } else {
    return new Response(JSON.stringify({ error: 'KV存储未配置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 添加用户到房间
  const existingUserIndex = room.activeUsers?.findIndex(u => u.id === userId);
  if (existingUserIndex === -1 || !room.activeUsers) {
    if (!room.activeUsers) room.activeUsers = [];
    room.activeUsers.push(userData);
  }
  
  room.lastUpdated = Date.now();
  
  // 更新存储
  if (env.COLLAB_KV) {
    await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
  }
  
  return new Response(JSON.stringify({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      method: room.method,
      createdBy: room.createdBy,
      createdByName: room.createdByName,
      activeUsers: room.activeUsers
    },
    snapshot: room.snapshot,
    message: '加入房间成功'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 离开房间
async function handleLeaveRoom(request, env) {
  const { roomId, userId } = await request.json();
  
  let room;
  const roomKey = `room:${roomId}`;
  
  if (env.COLLAB_KV) {
    const roomData = await env.COLLAB_KV.get(roomKey);
    if (!roomData) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } else {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 移除用户
  room.activeUsers = room.activeUsers?.filter(u => u.id !== userId) || [];
  room.lastUpdated = Date.now();
  
  // 如果房间为空，清理房间（可选）
  if (room.activeUsers.length === 0) {
    if (env.COLLAB_KV) {
      await env.COLLAB_KV.delete(roomKey);
    }
  } else {
    // 更新存储
    if (env.COLLAB_KV) {
      await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
    }
  }
  
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 发送操作
async function handleSendOperation(request, env) {
  const { roomId, userId, operation } = await request.json();
  
  let room;
  const roomKey = `room:${roomId}`;
  
  if (env.COLLAB_KV) {
    const roomData = await env.COLLAB_KV.get(roomKey);
    if (!roomData) {
      return new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } else {
    return new Response(JSON.stringify({ error: 'KV存储未配置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 添加操作到历史
  if (!room.operations) {
    room.operations = [];
  }
  
  room.operations.push({
    ...operation,
    timestamp: Date.now(),
    userId,
    id: `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  });
  
  // 限制操作历史大小
  if (room.operations.length > 100) {
    room.operations = room.operations.slice(-50);
  }
  
  room.lastUpdated = Date.now();
  
  // 更新存储
  if (env.COLLAB_KV) {
    await env.COLLAB_KV.put(roomKey, JSON.stringify(room));
  }
  
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 获取更新
async function handleGetUpdates(request, env) {
  const roomId = request.url.searchParams.get('roomId');
  const userId = request.url.searchParams.get('userId');
  const lastSync = parseInt(request.url.searchParams.get('lastSync') || '0');
  
  let room;
  const roomKey = `room:${roomId}`;
  
  if (env.COLLAB_KV) {
    const roomData = await env.COLLAB_KV.get(roomKey);
    if (!roomData) {
      return new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } else {
    return new Response(JSON.stringify({ error: 'KV存储未配置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  // 获取上次同步后的新操作
  const updates = (room.operations || []).filter(op => 
    op.timestamp > lastSync && op.userId !== userId
  );
  
  return new Response(JSON.stringify({
    success: true,
    updates,
    users: room.activeUsers || [],
    lastSync: Date.now()
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 获取房间信息
async function handleGetRoomInfo(request, env) {
  const roomId = request.url.searchParams.get('roomId');
  
  let room;
  const roomKey = `room:${roomId}`;
  
  if (env.COLLAB_KV) {
    const roomData = await env.COLLAB_KV.get(roomKey);
    if (!roomData) {
      return new Response(JSON.stringify({ error: '房间不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    room = JSON.parse(roomData);
  } else {
    return new Response(JSON.stringify({ error: 'KV存储未配置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  return new Response(JSON.stringify({
    success: true,
    room: {
      id: room.id,
      name: room.name,
      method: room.method,
      createdBy: room.createdBy,
      createdByName: room.createdByName,
      activeUsers: room.activeUsers || []
    },
    snapshot: room.snapshot
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
