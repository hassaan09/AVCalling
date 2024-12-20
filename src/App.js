import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = 'https://3606-2407-d000-f-cad2-282e-7f18-8a82-becc.ngrok-free.app'; // Update with your server URL
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3NTI5Njg1MDRmMjEzZWJmZDVmYjAyYyIsImVtYWlsIjoiYmV0YUBnbWFpbC5jb20iLCJ1c2VybmFtZSI6ImJldGEiLCJpYXQiOjE3MzQ2ODgzOTUsImV4cCI6MTczNDc3NDc5NX0.jW1cAZQKbY9qNXQcP6g_VyHRahaT_FqaXOP5AA9Sk-g'; // Replace with your actual token

let peerConnection = null;
let localStream = null;
let remoteStream = new MediaStream();


const CallComponent = () => {
  const [socket, setSocket] = useState(null);
  const [receiverId, setReceiverId] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    const socketInstance = io(`${SERVER_URL}/im`, {
      query: { token },
    });

    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      console.log('Connected to server');
    });

    socketInstance.on('incomingCall', (callData) => {
      console.log(`Incoming call from ${callData.senderName} (${callData.callType})`);
      setIncomingCall(callData);
      setCallStatus('Incoming');
    });

    socketInstance.on('callAnswered', (data) => {
      console.log(`Call ${data.callId} answered`);
      setCallStatus('Answered');
    });

    socketInstance.on('callRejected', (data) => {
      console.log(`Call ${data.callId} rejected`);
      setCallStatus('Rejected');
      setIncomingCall(null);
    });

    socketInstance.on('callEnded', () => {
      console.log('The call has ended.');
      setCallStatus('Ended');
      setIncomingCall(null);
      localStream = null;
      remoteStream = new MediaStream();
    });

    socketInstance.on('remoteStream', (stream) => {
      remoteStream = stream;
      console.log('Received remote stream:', stream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
    });

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const configuration = {
    iceServers: [{ urls: 'stun:stunprotocol.org:3478' }],
  };

  // WebRTC setup function
  const setupWebRTCConnection = async (callType) => {
    try {
      console.log('Setting up WebRTC connection...');
      localStream = await navigator.mediaDevices.getUserMedia({
        video: callType === 'video',
        audio: true,
      });
      console.log('Local stream captured:', localStream);

      // Assign local stream to the local video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      remoteStream = new MediaStream();
      peerConnection = new RTCPeerConnection(configuration);

      // Add local stream tracks to peer connection
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      // Handle incoming remote stream
      peerConnection.ontrack = (event) => {
        console.log('Received remote stream track:', event);
        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('ICE Candidate:', event.candidate);
          socket.emit('iceCandidate', { peerId: receiverId, candidate: event.candidate });
        }
      };

      // Offer/answer flow
      if (callType === 'video') {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { receiverId, offer });
      }

      socket.on('offer', async ({ senderId, offer }) => {
        console.log('Received offer from', senderId);
        await peerConnection.setRemoteDescription(offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { senderId, answer });
      });

      socket.on('answer', async ({ receiverId, answer }) => {
        console.log('Received answer from', receiverId);
        await peerConnection.setRemoteDescription(answer);
      });

      socket.on('iceCandidate', async ({ candidate }) => {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      });
    } catch (err) {
      console.error('Error setting up WebRTC:', err);
    }
  };

  // Handle answering the incoming call
  const handleAnswerCall = () => {
    if (socket && incomingCall) {
      console.log('Answering call:', incomingCall);
      
      // Emit the 'answerCall' event to the server
      socket.emit('answerCall', { callId: incomingCall.callId });
  
      // Set call status to "Answered"
      setCallStatus('Answered');
      setIncomingCall(null);
  
      // Set up WebRTC connection with the call type
      setupWebRTCConnection(incomingCall.callType);
  
      // Emit the 'callAnswered' event to inform the other peer
      socket.emit('callAnswered', { callId: incomingCall.callId, receiverId });
  
      // Now the local peer has answered the call and the server should pass it along to the other peer.
    }
  };
  

  const handleRejectCall = () => {
    if (socket && incomingCall) {
      console.log('Rejecting call:', incomingCall);
      socket.emit('rejectCall', { callId: incomingCall.callId });
      setCallStatus('Rejected');
      setIncomingCall(null);
    }
  };

  const endCall = () => {
    if (socket) {
      socket.emit('endCall');
      console.log('Ending the call');
      setCallStatus('Ended');
      localStream = null;
      remoteStream = new MediaStream();
      if (peerConnection) {
        peerConnection.close();  // Close the peer connection
        peerConnection = null;
      }
    }
  };
  

  const initiateCall = (type) => {
    if (socket && receiverId) {
      socket.emit('initiateCall', { receiverId, callType: type });
      console.log(`Initiating ${type} call to ${receiverId}`);
      setCallStatus(`Calling ${receiverId}...`);
      setupWebRTCConnection(type);
    } else {
      console.log('Receiver ID is not set!');
    }
  };

  return (
    <div className="call-container">
      <h2>1-1 Calling</h2>

      <div className="video-call-container">
        {/* Local Stream (User's Video) */}
        <div className="video-box">
          <video
            ref={localVideoRef}
            className="local-video"
            autoPlay
            muted
            playsInline
          />
        </div>

        {/* Remote Stream (Receiver's Video) */}
        <div className="video-box">
          <video
            ref={remoteVideoRef}
            className="remote-video"
            autoPlay
            playsInline
          />
        </div>
      </div>

      <div className="call-controls">
        <button className="control-btn" onClick={endCall}>End Call</button>
      </div>

      {/* Overlay for Incoming Call */}
      {incomingCall && callStatus === 'Incoming' && (
        <div className="overlay">
          <div className="overlay-content">
            <h3>Incoming call from {incomingCall.senderName}</h3>
            <button onClick={handleAnswerCall} className="answer-btn">Answer</button>
            <button onClick={handleRejectCall} className="reject-btn">Reject</button>
          </div>
        </div>
      )}

      {/* Input and Button to Start Call */}
      <div className="call-initiation">
        <input
          type="text"
          placeholder="Enter participant ID"
          value={receiverId}
          onChange={(e) => setReceiverId(e.target.value)}
        />
        <br />
        <button onClick={() => initiateCall('audio')}>Start Audio Call</button>
        <button onClick={() => initiateCall('video')}>Start Video Call</button>
      </div>
    </div>
  );
};

export default CallComponent;

